import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
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
    statusBarItem.tooltip = "Time Tracker";
  };

  updateStatusBar();
  // Update time tracker bar once per minute
  const timer = setInterval(updateStatusBar, 60000);

  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate() {}
