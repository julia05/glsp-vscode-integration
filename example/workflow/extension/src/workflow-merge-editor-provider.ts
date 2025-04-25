/********************************************************************************
 * Copyright (c) 2021-2023 EclipseSource and others.
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
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.01
 ********************************************************************************/
import {
    GLSPDiagramIdentifier,
    GlspEditorProvider,
    GlspVscodeConnector,
    serializeUri,
    WebviewEndpoint
} from '@eclipse-glsp/vscode-integration';
import * as vscode from 'vscode';
import { getGitFiles } from './git-util';
import path = require('path');

export interface WorkflowMergeDocument extends vscode.CustomDocument {
    readonly side: 'base' | 'local' | 'remote';
}

export namespace WorkflowMergeDocument {
    export function is(value: any): value is WorkflowMergeDocument {
        return value?.diffId && (value.side === 'local' || value.side === 'remote' || value.side === 'base');
    }
}

export interface WorkflowMergeDiagramIdentifier extends GLSPDiagramIdentifier {
    merge?: {
        id: string;
        side: 'base' | 'local' | 'remote';
        // TODO: das mit dem content wäre eine andere Variante, um nicht die hardcoded remote und base files zu haben
        // content: string;
    };
}

export default class WorkflowMergeEditorProvider extends GlspEditorProvider {
    diagramType = 'workflow-diagram';

    constructor(
        protected readonly extensionContext: vscode.ExtensionContext,
        protected override readonly glspVscodeConnector: GlspVscodeConnector
    ) {
        super(glspVscodeConnector);
    }

    setUpWebview(
        _document: vscode.CustomDocument,
        _webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
        _clientId: string
    ): void {
        console.log('webview from super class, not used because other input parameters needed');
    }

    override async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        console.log('--------------- OPEN IN MERGE EDITOR ---------------');

        return { uri, dispose: () => undefined };
    }

    override async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        console.log('--------------- RESOLVE IN MERGE EDITOR ---------------');

        const gitFiles = await getGitFiles(document.uri);
        const fileName = document.uri.toString().split('/').reverse()[0];

        const baseUri = await this.saveContentAndCreateUri(gitFiles.base, 'base-' + fileName);
        const baseDoc = <WorkflowMergeDocument>{ uri: baseUri, dispose: () => undefined, side: 'base' };
        const baseDiagramIdentifier: WorkflowMergeDiagramIdentifier = {
            diagramType: this.diagramType,
            uri: serializeUri(baseUri),
            clientId: `${this.diagramType}_${this.viewCount++}`
        };

        const localUri = await this.saveContentAndCreateUri(gitFiles.local, 'local-' + fileName);
        const localDoc = <WorkflowMergeDocument>{ uri: localUri, dispose: () => undefined, side: 'local' };
        const localeDiagramIdentifier: WorkflowMergeDiagramIdentifier = {
            diagramType: this.diagramType,
            uri: serializeUri(localUri),
            clientId: `${this.diagramType}_${this.viewCount++}`
        };

        const remoteUri = await this.saveContentAndCreateUri(gitFiles.remote, 'remote-' + fileName);
        const remoteDoc = <WorkflowMergeDocument>{ uri: remoteUri, dispose: () => undefined, side: 'remote' };
        const remoteDiagramIdentifier: WorkflowMergeDiagramIdentifier = {
            diagramType: this.diagramType,
            uri: serializeUri(remoteUri),
            clientId: `${this.diagramType}_${this.viewCount++}`
        };

        // create 3 endpoints for same webviewPanel
        const baseEndpoint = new WebviewEndpoint({
            diagramIdentifier: baseDiagramIdentifier,
            messenger: this.glspVscodeConnector.messenger,
            webviewPanel
        });

        const localEndpoint = new WebviewEndpoint({
            diagramIdentifier: localeDiagramIdentifier,
            messenger: this.glspVscodeConnector.messenger,
            webviewPanel
        });

        const remoteEndpoint = new WebviewEndpoint({
            diagramIdentifier: remoteDiagramIdentifier,
            messenger: this.glspVscodeConnector.messenger,
            webviewPanel
        });

        console.log(this.glspVscodeConnector.messenger);

        console.log('webview endpoints created');

        this.glspVscodeConnector.registerClient({
            clientId: baseDiagramIdentifier.clientId,
            diagramType: baseDiagramIdentifier.diagramType,
            document: baseDoc,
            webviewEndpoint: baseEndpoint
        });

        console.log('glsp register client for base done');

        this.glspVscodeConnector.registerClient({
            clientId: localeDiagramIdentifier.clientId,
            diagramType: localeDiagramIdentifier.diagramType,
            document: localDoc,
            webviewEndpoint: localEndpoint
        });

        console.log('glsp register client for locale done');

        this.glspVscodeConnector.registerClient({
            clientId: remoteDiagramIdentifier.clientId,
            diagramType: remoteDiagramIdentifier.diagramType,
            document: remoteDoc,
            webviewEndpoint: remoteEndpoint
        });

        this.setUpMergeWebviewPanels(
            localDoc,
            webviewPanel,
            token,
            baseDiagramIdentifier.clientId,
            localeDiagramIdentifier.clientId,
            remoteDiagramIdentifier.clientId
        );
    }

    async saveContentAndCreateUri(content: string, fileName: string): Promise<vscode.Uri> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        if (workspaceFolder === undefined) {
            throw new Error('folder not found, can not go further');
        }

        const folderPath = path.join(workspaceFolder.uri.fsPath, 'temp-merge-files');
        const folderUri = vscode.Uri.file(folderPath);
        await vscode.workspace.fs.createDirectory(folderUri);

        const filePath = path.join(folderPath, fileName);
        const fileUri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content));

        return fileUri;
    }

    setUpMergeWebviewPanels(
        _localDoc: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
        clientIdBase: string,
        clientIdLocale: string,
        clientIdRemote: string
    ): void {
        console.log('start - setup webview');

        const webview = webviewPanel.webview;
        const extensionUri = this.extensionContext.extensionUri;
        const webviewScriptSourceUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));

        webview.options = {
            enableScripts: true
        };

        webview.html = `
            <!DOCTYPE html>
            <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, height=device-height">
                    <meta http-equiv="Content-Security-Policy" content="
                    default-src http://*.fontawesome.com  ${webview.cspSource} 'unsafe-inline' 'unsafe-eval';
                    ">
                    <style>
                        body { display: flex; height: 100vh; }
                        .panel { flex: 1; overflow: auto; border: 1px solid #ccc; }
                    </style>
                </head>
                <body>
                    <div id="${clientIdLocale}_container" class="panel"></div>
                    <div id="${clientIdBase}_container" class="panel"></div>
                    <div id="${clientIdRemote}_container" class="panel"></div>

                    <script src="${webviewScriptSourceUri}"></script>
                </body>
            </html>`;

        // failed attempt with iframe
        /*
        <iframe
            id="editor1"
            srcdoc="${getFileWebview(webviewPanel, this.glspVscodeConnector, webviewScriptSourceUri, baseUri)}"
        >
        </iframe>
        */
    }
}
