import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const servicesDir = path.join(process.cwd(), 'lib', 'services');

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else if (file.endsWith('.ts')) {
      arrayOfFiles.push(fullPath);
    }
  });
  return arrayOfFiles;
}

const files = getAllFiles(servicesDir);

const calls = [];

files.forEach((filePath) => {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(process.cwd(), filePath);
  const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true);

  function walk(node, functionStack) {
    let nextStack = functionStack;
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      nextStack = [...functionStack, node];
    }

    if (ts.isCallExpression(node)) {
      const exprText = node.expression.getText(sourceFile);
      const parts = exprText.split('.');
      const method = parts[parts.length - 1];

      if (['delete', 'update'].includes(method) && parts.length >= 3) {
        const caller = parts[0];
        if (['prisma', 'tx', 'db', 'scopedDb', 'ctx'].includes(caller)) {
          const model = parts[parts.length - 2];
          const lineAndChar = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          const lineNum = lineAndChar.line + 1;
          const callText = node.getText(sourceFile);

          const enclosingFunctionsText = nextStack.map(fn => fn.getText(sourceFile)).join('\n---\n');

          const outerFn = nextStack[nextStack.length - 1] || null;
          let fnStartLine = Math.max(1, lineNum - 15);
          let fnEndLine = lineNum + 15;
          if (outerFn) {
            const startChar = sourceFile.getLineAndCharacterOfPosition(outerFn.getStart(sourceFile));
            const endChar = sourceFile.getLineAndCharacterOfPosition(outerFn.getEnd(sourceFile));
            fnStartLine = startChar.line + 1;
            fnEndLine = endChar.line + 1;
          }

          const fileLines = fileContent.split('\n');
          const fnSnippet = fileLines.slice(fnStartLine - 1, fnEndLine).join('\n');

          calls.push({
            file: relPath,
            line: lineNum,
            caller,
            model,
            method,
            callText,
            fnSnippet,
            fnStartLine,
            fnEndLine,
            enclosingFunctionsText,
          });
        }
      }
    }

    ts.forEachChild(node, (child) => walk(child, nextStack));
  }

  walk(sourceFile, []);
});

const b2Mutations = calls.filter(c => {
  const normFile = c.file.replace(/\\/g, '/');
  const isPlatformOrAuthOrBilling = 
    normFile.startsWith('lib/services/platform/') ||
    normFile.startsWith('lib/services/auth/') ||
    normFile.startsWith('lib/services/billing/') ||
    normFile.startsWith('lib/services/notification/') ||
    normFile.startsWith('lib/services/developerApp/') ||
    c.model.startsWith('platform') ||
    c.model.startsWith('notification') ||
    c.model.startsWith('apiKey') ||
    c.model.startsWith('developerApplication') ||
    c.model === 'session' ||
    c.model === 'verificationToken';

  const isScopedDb = 
    c.caller === 'scopedDb' ||
    c.caller.includes('scopedDb') ||
    normFile.includes('reporting') ||
    c.enclosingFunctionsText.includes('createScopedDb');

  const hasDirectWorkspaceIdInCall = c.callText.includes('workspaceId');

  const hasWorkspaceIdInFunction = 
    c.enclosingFunctionsText.includes('workspaceId') || 
    c.enclosingFunctionsText.includes('requireWorkspaceAuthorization') ||
    c.enclosingFunctionsText.includes('authorizeWorkspace');

  return !isPlatformOrAuthOrBilling && !isScopedDb && !hasDirectWorkspaceIdInCall && hasWorkspaceIdInFunction;
});

console.log(`Found ${b2Mutations.length} Bucket 2 update/delete calls.`);
b2Mutations.slice(0, 5).forEach((m, idx) => {
  console.log(`\n=================== B2 Mutation Sample ${idx + 1}: ${m.file}:${m.line} [${m.model}.${m.method}] ===================`);
  console.log(`Lines ${m.fnStartLine}-${m.fnEndLine}:`);
  console.log(m.fnSnippet);
});
