import fs from "node:fs";
import path from "node:path";

export interface BoundaryViolation {
  filePath: string;
  lineNumber: number;
  variableName: string;
  snippet: string;
}

const SECRET_PATTERN = /(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|PRIVATE|AUTH|DATABASE_URL)/i;
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".next", ".git", "coverage", "dist", "generated"]);

/**
 * Recursively find all source files.
 */
function findSourceFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findSourceFiles(fullPath));
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Scan a file for client boundary violations.
 */
export function scanFileForClientBoundaryViolations(filePath: string, content?: string): BoundaryViolation[] {
  const fileContent = content ?? fs.readFileSync(filePath, "utf-8");

  // Check if file is a client component
  const hasUseClient =
    /^\s*['"]use client['"]/m.test(fileContent) ||
    /^\s*\/\*.*\*\/\s*['"]use client['"]/m.test(fileContent);

  if (!hasUseClient) {
    return [];
  }

  const violations: BoundaryViolation[] = [];
  const lines = fileContent.split("\n");

  const envRegex = /process\.env(?:\.([A-Za-z0-9_]+)|\[\s*['"`]([A-Za-z0-9_]+)['"`]\s*\])/g;

  lines.forEach((line, index) => {
    // Skip single-line comments
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) return;

    let match: RegExpExecArray | null;
    while ((match = envRegex.exec(line)) !== null) {
      const varName = match[1] || match[2];
      if (varName && !varName.startsWith("NEXT_PUBLIC_")) {
        // Any non-NEXT_PUBLIC_ env access in a client component is invalid in Next.js,
        // and matching a secret pattern is an immediate high-severity security risk.
        violations.push({
          filePath,
          lineNumber: index + 1,
          variableName: varName,
          snippet: line.trim(),
        });
      }
    }
  });

  return violations;
}

/**
 * Scan the entire repository for client boundary violations.
 */
export function auditClientEnvBoundary(rootDir: string = process.cwd()): BoundaryViolation[] {
  const targetDirs = ["app", "components", "lib"];
  const rootFiles = ["proxy.ts", "auth.ts", "instrumentation.ts"]
    .map((f) => path.join(rootDir, f))
    .filter((f) => fs.existsSync(f));

  const allFiles: string[] = [...rootFiles];
  for (const dir of targetDirs) {
    allFiles.push(...findSourceFiles(path.join(rootDir, dir)));
  }

  const allViolations: BoundaryViolation[] = [];
  for (const file of allFiles) {
    const violations = scanFileForClientBoundaryViolations(file);
    allViolations.push(...violations);
  }

  return allViolations;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}` || require.main === module) {
  console.log("Auditing client-side components for non-NEXT_PUBLIC_ secrets...");
  const violations = auditClientEnvBoundary();

  if (violations.length > 0) {
    console.error(`\n❌ Found ${violations.length} client/server environment boundary violation(s):`);
    for (const v of violations) {
      console.error(
        `  - ${v.filePath}:${v.lineNumber} references non-public env '${v.variableName}'`
      );
      console.error(`    Code: ${v.snippet}`);
    }
    process.exit(1);
  } else {
    console.log("✅ Client/server environment boundary verified: 0 secret leaks detected.");
    process.exit(0);
  }
}
