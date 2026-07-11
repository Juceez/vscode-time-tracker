import * as fs from "node:fs/promises";
import * as path from "node:path";
import initSqlJs, { Database } from "sql.js";
import * as vscode from "vscode";
import * as fsSync from "node:fs";

let currentSessionId: number | undefined;
let db: Database | undefined;
let save: (() => Promise<void>) | undefined;
let startedAt: string | undefined;
let dbPath: string | undefined;

export async function openDatabase(context: vscode.ExtensionContext) {
  await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });

  const dbPath = path.join(
    context.globalStorageUri.fsPath,
    "time-tracker.sqlite",
  );
  const SQL = await initSqlJs();
  const file = await fs.readFile(dbPath).catch(() => undefined);
  const db =
    file && file.length > 0 ? new SQL.Database(file) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_minutes INTEGER,
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
  const dbObject = await openDatabase(context);
  db = dbObject.db;
  save = dbObject.save;
  dbPath = dbObject.dbPath;

  // Get repo path and name for the current session
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let repoPath: string | null = null;
  let repoName: string | null = null;

  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspaceFolder = workspaceFolders[0];
    repoPath = workspaceFolder.uri.fsPath;
    repoName = path.basename(repoPath);
  }

  // Create a session row on startup
  startedAt = new Date().toISOString();
  db.run(
    "INSERT INTO sessions (started_at, repo_path, repo_name) VALUES (?, ?, ?)",
    [startedAt, repoPath, repoName],
  );
  const result = db.exec("SELECT last_insert_rowid()");
  currentSessionId = result[0].values[0][0] as number;
  await save();

  // Command to open the sqlite file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "time-tracker.openDatabaseFile",
      async () => {
        const dbUri = vscode.Uri.file(dbPath!);

        // Check if the file exists before trying to open it
        try {
          await fs.access(dbPath!);
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

  // Sum today's sessions' minutes
  const todaySessions = db!.exec(
    "SELECT COALESCE(SUM(duration_minutes), 0) AS total FROM sessions WHERE date(started_at) = date('now')",
  );
  const todayMinutes = todaySessions[0].values[0][0] as number;

  // Count time from extension start
  const startTime = new Date();

  // Track time by comparing to when session started and add today's stored minutes
  const updateStatusBar = () => {
    const now = new Date();
    const sessionMinutes = Math.floor(
      (now.getTime() - startTime.getTime()) / 60000,
    );
    const totalMinutes =
      Math.floor((now.getTime() - startTime.getTime()) / 60000) + todayMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const timeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    statusBarItem.text = `Today: ${timeText}`;
    statusBarItem.tooltip = "(Click to view stats (WIP))";

    // Write session minutes to db every minute to prevent data loss
    if (db && currentSessionId) {
      const endedAt = new Date().toISOString();
      db.run(
        "UPDATE sessions SET ended_at = ?, duration_minutes = ? WHERE id = ?",
        [endedAt, sessionMinutes, currentSessionId],
      );
      save!();
    }
  };

  updateStatusBar();
  // Update time tracker bar once per minute
  const timer = setInterval(updateStatusBar, 60000);

  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate() {
  // Write session end and minutes to db
  if (db && currentSessionId && startedAt && dbPath) {
    const endedAt = new Date().toISOString();
    db.run(
      "UPDATE sessions SET ended_at = ?, duration_minutes = ? WHERE id = ?",
      [
        endedAt,
        Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000),
        currentSessionId,
      ],
    );
    const data = db.export();
    fsSync.writeFileSync(dbPath, Buffer.from(data));
    db.close();
  }
}
