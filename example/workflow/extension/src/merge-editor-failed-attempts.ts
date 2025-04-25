/********************************************************************************
 * Copyright (c) 2025 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
import { GLSPDiagramIdentifier, GlspVscodeConnector, serializeUri, WebviewEndpoint } from '@eclipse-glsp/vscode-integration';
import * as path from 'path';
import * as vscode from 'vscode';
import { getGitFiles } from './git-util';

export async function getWebviewContent(
    context: vscode.ExtensionContext,
    glspVscodeConnector: GlspVscodeConnector<vscode.CustomDocument>,
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri
): Promise<string> {
    const localDoc: vscode.CustomDocument = { uri: documentUri, dispose: () => undefined };
    const localeDiagramIdentifier: GLSPDiagramIdentifier = {
        diagramType: 'workflow-diagram',
        uri: serializeUri(documentUri),
        clientId: 'workflow-diagram_1'
    };

    const gitFiles = await getGitFiles(documentUri);
    const fileName = documentUri.toString().split('/').reverse()[0];

    const baseUri = await saveContentAndCreateUri(gitFiles.base, 'base-' + fileName);
    const baseDoc: vscode.CustomDocument = { uri: baseUri, dispose: () => undefined };
    const baseDiagramIdentifier: GLSPDiagramIdentifier = {
        diagramType: 'workflow-diagram',
        uri: serializeUri(baseUri),
        clientId: 'workflow-diagram_5'
    };

    const endpoint = new WebviewEndpoint({
        diagramIdentifier: localeDiagramIdentifier,
        messenger: glspVscodeConnector.messenger,
        webviewPanel: panel
    });

    console.log('webview endpoint created');

    glspVscodeConnector.registerClient({
        clientId: localeDiagramIdentifier.clientId,
        diagramType: localeDiagramIdentifier.diagramType,
        document: localDoc,
        webviewEndpoint: endpoint
    });

    glspVscodeConnector.registerClient({
        clientId: baseDiagramIdentifier.clientId,
        diagramType: baseDiagramIdentifier.diagramType,
        document: baseDoc,
        webviewEndpoint: endpoint
    });

    const webviewScriptSourceUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'));
    return `<!DOCTYPE html>
    <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Merge Conflict Files</title>
            <style>
                .editor-grid { display: flex; height: 100vh; }
                .panel { flex: 1; overflow: auto; border: 1px solid #ccc; }
            </style>
        </head>
        <body>
            <div class="editor-grid">
                <div id="${localeDiagramIdentifier.clientId}_container" class="panel"></div>
            </div>
            <script src="${webviewScriptSourceUri}"></script>
        </body>
    </html>`;
}

// iframe src
// src="${panel.webview.asWebviewUri(documentUri)}"
export function getWebviewContentIframes(
    context: vscode.ExtensionContext,
    connector: GlspVscodeConnector<vscode.CustomDocument>,
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri
): string {
    const webviewScriptSourceUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'));
    return `<!DOCTYPE html>
    <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Merge Conflict Files</title>
            <style>
                .editor-grid { display: flex; height: 100vh; }
                iframe {
                    border: none;
                    background: var(--vscode-editor-background);
                }
            </style>
        </head>
        <body>
            <div class="editor-grid">
                <iframe 
                    id="editor1"
                    srcdoc="${getFileWebview(panel, connector, webviewScriptSourceUri, documentUri)}"
                >
                </iframe>
                <iframe id="editor2" src="" sandbox="allow-scripts allow-same-origin"></iframe>
                <iframe id="editor3" src="" sandbox="allow-scripts allow-same-origin"></iframe>
            </div>
        </body>
    </html>`;
}

export function getFileWebview(
    panel: vscode.WebviewPanel,
    glspVscodeConnector: GlspVscodeConnector<vscode.CustomDocument>,
    scriptUri: vscode.Uri,
    documentUri: vscode.Uri
): string {
    const doc: vscode.CustomDocument = { uri: documentUri, dispose: () => undefined };
    const localeDiagramIdentifier: GLSPDiagramIdentifier = {
        diagramType: 'workflow-diagram',
        uri: serializeUri(documentUri),
        clientId: 'workflow-diagram_1'
    };

    const endpoint = new WebviewEndpoint({
        diagramIdentifier: localeDiagramIdentifier,
        messenger: glspVscodeConnector.messenger,
        webviewPanel: panel
    });

    console.log('webview endpoint created');

    glspVscodeConnector.registerClient({
        clientId: localeDiagramIdentifier.clientId,
        diagramType: localeDiagramIdentifier.diagramType,
        document: doc,
        webviewEndpoint: endpoint
    });

    const html = `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, height=device-height">
                <meta http-equiv="Content-Security-Policy" content="
            default-src http://*.fontawesome.com ${panel.webview.cspSource} 'unsafe-inline' 'unsafe-eval'">

            </head>
            <body>
                <div id="${localeDiagramIdentifier.clientId}_container" style="height: 100%;"></div>
                <script src="${scriptUri}"></script>
            </body>
        </html>`;

    return html.replace(/"/g, '&quot;');
}

async function saveContentAndCreateUri(content: string, fileName: string): Promise<vscode.Uri> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (workspaceFolder === undefined) {
        throw new Error('can not go further');
    }

    const folderPath = path.join(workspaceFolder.uri.fsPath, 'temp-merge-files');
    const folderUri = vscode.Uri.file(folderPath);
    await vscode.workspace.fs.createDirectory(folderUri);

    const filePath = path.join(folderPath, fileName);
    const fileUri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content));

    return fileUri;
}
