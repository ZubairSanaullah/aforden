import fs from 'fs';
import path from 'path';
import ts from 'typescript';

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

const servicesDir = path.join(process.cwd(), 'lib', 'services');
const files = getAllFiles(servicesDir);

const prismaMethods = new Set([
  'findFirst', 'findUnique', 'findMany', 'update', 'updateMany',
  'delete', 'deleteMany', 'count', 'aggregate', 'groupBy', 'upsert', 'create', 'createMany'
]);

const calls = [];

files.forEach((filePath) => {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(process.cwd(), filePath);
  const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true);

  function walk(node, parentFunctionNode) {
    let currentFunctionNode = parentFunctionNode;
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      currentFunctionNode = node;
    }

    if (ts.isCallExpression(node)) {
      // Check if expression is of form caller.model.method or ctx.scopedDb.model.method
      const exprText = node.expression.getText(sourceFile);
      const parts = exprText.split('.');
      const method = parts[parts.length - 1];

      if (prismaMethods.has(method) && parts.length >= 3) {
        const caller = parts[0];
        if (['prisma', 'tx', 'db', 'scopedDb', 'ctx'].includes(caller)) {
          const model = parts[parts.length - 2];
          const lineAndChar = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          const lineNum = lineAndChar.line + 1;
          const callText = node.getText(sourceFile);

          let functionText = '';
          if (currentFunctionNode) {
            functionText = currentFunctionNode.getText(sourceFile);
          } else {
            // Module level call
            functionText = fileContent;
          }

          calls.push({
            file: relPath,
            line: lineNum,
            caller,
            model,
            method,
            callText,
            functionText,
            hasWorkspaceIdInCall: callText.includes('workspaceId'),
            hasWorkspaceIdInFunction: functionText.includes('workspaceId') ||
                                      functionText.includes('requireWorkspaceAuthorization') ||
                                      functionText.includes('authorizeWorkspace'),
          });
        }
      }
    }

    ts.forEachChild(node, (child) => walk(child, currentFunctionNode));
  }

  walk(sourceFile, null);
});

console.log(`Total Prisma Calls found via TS AST: ${calls.length}`);
