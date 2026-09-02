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

const prismaQueryMutationMethods = new Set([
  'findFirst', 'findUnique', 'findMany', 'update', 'updateMany',
  'delete', 'deleteMany', 'count', 'aggregate'
]);

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

      if (prismaQueryMutationMethods.has(method) && parts.length >= 3) {
        const caller = parts[0];
        if (['prisma', 'tx', 'db', 'scopedDb', 'ctx'].includes(caller)) {
          const model = parts[parts.length - 2];
          const lineAndChar = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          const lineNum = lineAndChar.line + 1;
          const callText = node.getText(sourceFile);

          // Get text of all enclosing AST function scopes (from inner to outermost function)
          const enclosingFunctionsText = nextStack.map(fn => fn.getText(sourceFile)).join('\n---\n');

          calls.push({
            file: relPath,
            line: lineNum,
            caller,
            model,
            method,
            callText,
            enclosingFunctionsText,
            fullFileContent: fileContent,
          });
        }
      }
    }

    ts.forEachChild(node, (child) => walk(child, nextStack));
  }

  walk(sourceFile, []);
});

const buckets = {
  directWorkspaceId: [],
  parentRelationScope: [],
  scopedDbWrapper: [],
  platformGlobalAuth: [],
  unscopedOrAmbiguous: []
};

calls.forEach((c) => {
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
    c.model === 'verificationToken' ||
    (c.model === 'user' && (normFile.includes('platform') || normFile.includes('auth'))) ||
    (c.model === 'workspace' && c.method === 'findUnique');

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

  if (isPlatformOrAuthOrBilling) {
    buckets.platformGlobalAuth.push(c);
  } else if (isScopedDb) {
    buckets.scopedDbWrapper.push(c);
  } else if (hasDirectWorkspaceIdInCall) {
    buckets.directWorkspaceId.push(c);
  } else if (hasWorkspaceIdInFunction) {
    buckets.parentRelationScope.push(c);
  } else {
    buckets.unscopedOrAmbiguous.push(c);
  }
});

console.log(`Total Calls: ${calls.length}`);
console.log(`Bucket 1 (Direct workspaceId in Call): ${buckets.directWorkspaceId.length}`);
console.log(`Bucket 2 (Parent Relation / Function Scope): ${buckets.parentRelationScope.length}`);
console.log(`Bucket 3 (Scoped DB Wrapper): ${buckets.scopedDbWrapper.length}`);
console.log(`Bucket 4 (Platform / Auth / Billing / Worker / Global): ${buckets.platformGlobalAuth.length}`);
console.log(`Bucket 5 (Unscoped / Ambiguous): ${buckets.unscopedOrAmbiguous.length}`);
