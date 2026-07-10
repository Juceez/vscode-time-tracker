import * as fs from "node:fs/promises";
import * as path from "node:path";
import initSqlJs from "sql.js";
import * as vscode from "vscode";

export async function openDatabase(context: vscode.ExtensionContext) {
  await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });

  const dbPath = path.join(
    context.globalStorageUri.fsPath,
    "time-tracker.sqlite",
  );
  const SQL = await initSqlJs();
  const file = await fs.readFile(dbPath).catch(() => undefined);
  const db = file ? new SQL.Database(file) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER,
      repo_path TEXT,
      repo_name TEXT
    );

    CREATE TABLE IF NOT EXISTS session_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      opened_at TEXT,
      closed_at TEXT,
      active_seconds INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);

  // Save immediately to write the .sqlite file to disk
  const data = db.export();
  await fs.writeFile(dbPath, Buffer.from(data));

  return {
    db,
    dbPath,
    async save() {
      const data = db.export();
      await fs.writeFile(dbPath, Buffer.from(data));
    },
  };
}

export async function activate(context: vscode.ExtensionContext) {
  const { dbPath } = await openDatabase(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "time-tracker.openDatabaseFile",
      async () => {
        const dbUri = vscode.Uri.file(dbPath);

        // Check if the file exists before trying to open it
        try {
          await fs.access(dbPath);
          await vscode.env.openExternal(dbUri);
        } catch {
          vscode.window.showErrorMessage(
            `Database file not found at ${dbPath}`,
          );
        }
      },
    ),
  );

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );

  // Count time from extension start
  const startTime = new Date();

  // Track time by comparing to when extension first opened
  const updateStatusBar = () => {
    const now = new Date();
    const totalMinutes = Math.floor(
      (now.getTime() - startTime.getTime()) / 60000,
    );
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const timeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    statusBarItem.text = `Today: ${timeText}`;
    statusBarItem.tooltip = "(Click to view stats (WIP))";
  };

  updateStatusBar();
  // Update time tracker bar once per minute
  const timer = setInterval(updateStatusBar, 60000);

  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate() {}
