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
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { GitExtension } from './types/git';
import util = require('util');
import path = require('path');
const exec = util.promisify(cp.exec);

export interface WorkflowMergeDocument extends vscode.CustomDocument {
    readonly side: 'base' | 'local' | 'remote';
}

export namespace WorkflowMergeDocument {
    export function is(value: any): value is WorkflowMergeDocument {
        return value?.diffId && (value.side === 'local' || value.side === 'remote' || value.side === 'base');
    }
}

export interface WorkflowDiagramIdentifier extends GLSPDiagramIdentifier {
    diff?: {
        id: string;
        side: 'left' | 'right';
        content: string;
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
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
        clientId: string
    ): void {
        console.log('WEEEBVIEW?');
    }

    override async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        console.log('--------------- OOOOOPPPEEEEEEN');
        console.log('MEEEEERGEEEE ---------------');

        return { uri, dispose: () => undefined };
    }

    override async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        console.log('--------------- REESSSOOOOOLVEE');
        console.log('MEEEEERGEEEE ---------------');

        console.log(document);
        console.log(document.uri);

        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

        if (gitExtension === undefined) {
            throw new Error('Git extension not found');
        }

        const api = gitExtension.exports.getAPI(1);

        const repo = api.repositories[0];

        console.log('REPO: ', repo);

        // this is only called, and after this command the repo.state is loaded
        await repo.status();

        const repoStateAfterStatusLoad = repo.state;

        const head = repo.state.HEAD;

        const refs = await repo.getRefs({});

        console.log('REPO STATE: ', repoStateAfterStatusLoad);

        const changes = repo.state.mergeChanges;

        console.log('HEAD: ', head);
        console.log('REFS: ', refs);
        console.log('CHANGEEES: ', changes);

        // git log --merge gets the conflict commits
        console.log(await repo.log({ path: document.uri.path }));

        const relativePath = document.uri.path.replace(repo.rootUri.path, '');
        console.log(relativePath);

        const repoRoot = repo.rootUri.path;
        const getBase = `git -C ${repoRoot} show :1:.${relativePath}`;
        const getLocal = `git -C ${repoRoot} show :2:.${relativePath}`;
        const getRemote = `git -C ${repoRoot} show :3:.${relativePath}`;

        const base = await this.runCommand(getBase);
        const local = await this.runCommand(getLocal);
        const remote = await this.runCommand(getRemote);

        if (base === undefined || local === undefined || remote === undefined) {
            throw new Error('Could not found Base or Remote');
        } else if (local.stdout.includes('<<<<<<< HEAD') || local.stdout.includes('=======') || local.stdout.includes('>>>>>>>')) {
            throw new Error('-- File is in merge conflict state');
        }

        const fileName = relativePath.split('/').reverse()[0];

        const baseUri = await this.saveContentAndCreateUri(base.stdout, 'base-' + fileName);
        const baseDoc = <WorkflowMergeDocument>{ uri: baseUri, dispose: () => undefined, side: 'base' };
        const baseDiagramIdentifier: GLSPDiagramIdentifier = {
            diagramType: this.diagramType,
            uri: serializeUri(baseUri),
            clientId: `${this.diagramType}_${this.viewCount++}`
        };

        const localUri = await this.saveContentAndCreateUri(local.stdout, 'local-' + fileName);
        const localDoc = <WorkflowMergeDocument>{ uri: localUri, dispose: () => undefined, side: 'local' };
        const localeDiagramIdentifier: GLSPDiagramIdentifier = {
            diagramType: this.diagramType,
            uri: serializeUri(localUri),
            clientId: `${this.diagramType}_${this.viewCount++}`
        };

        const remoteUri = await this.saveContentAndCreateUri(remote.stdout, 'remote-' + fileName);
        const remoteDoc = <WorkflowMergeDocument>{ uri: remoteUri, dispose: () => undefined, side: 'remote' };
        const remoteDiagramIdentifier: GLSPDiagramIdentifier = {
            diagramType: this.diagramType,
            uri: serializeUri(remoteUri),
            clientId: `${this.diagramType}_${this.viewCount++}`
        };

        console.log('initializing done', baseDiagramIdentifier.clientId, localeDiagramIdentifier.clientId);

        const endpoint = new WebviewEndpoint({
            diagramIdentifier: localeDiagramIdentifier,
            messenger: this.glspVscodeConnector.messenger,
            webviewPanel
        });

        console.log('webview endpoint created');

        this.glspVscodeConnector.registerClient({
            clientId: baseDiagramIdentifier.clientId,
            diagramType: baseDiagramIdentifier.diagramType,
            document: baseDoc,
            webviewEndpoint: endpoint
        });

        console.log('glsp register client for base done');

        this.glspVscodeConnector.registerClient({
            clientId: localeDiagramIdentifier.clientId,
            diagramType: localeDiagramIdentifier.diagramType,
            document: localDoc,
            webviewEndpoint: endpoint
        });

        console.log('glsp register client for locale done');

        this.glspVscodeConnector.registerClient({
            clientId: remoteDiagramIdentifier.clientId,
            diagramType: remoteDiagramIdentifier.diagramType,
            document: remoteDoc,
            webviewEndpoint: endpoint
        });

        this.setUpWebview3Panels(
            localDoc,
            baseUri,
            base.stdout,
            remoteUri,
            remote.stdout,
            webviewPanel,
            token,
            baseDiagramIdentifier.clientId,
            localeDiagramIdentifier.clientId,
            remoteDiagramIdentifier.clientId
        );
    }

    async runCommand(command: string): Promise<{ stdout: string; stderr: string } | undefined> {
        try {
            return exec(command);
        } catch (e) {
            console.error(e);
        }

        return undefined;
    }

    async saveContentAndCreateUri(content: string, fileName: string): Promise<vscode.Uri> {
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

    setUpWebview3Panels(
        local: vscode.CustomDocument,
        baseUri: vscode.Uri,
        base: string,
        remoteUri: vscode.Uri,
        remote: string,
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

        const webviewScriptSourceUri2 = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, '_locale_', 'dist', 'webview.js'));

        const webviewScriptSourceUri3 = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, '_remote_', 'dist', 'webview.js'));

        webviewPanel.webview.options = {
            enableScripts: true
        };

        console.log('after some initializing');

        webviewPanel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, height=device-height">
                    <meta http-equiv="Content-Security-Policy" content="
                    default-src http://*.fontawesome.com  ${webview.cspSource} 'unsafe-inline' 'unsafe-eval';
                    ">
                    <style>
                        .merge-container { display: flex; height: 100vh; }
                        .panel { flex: 1; overflow: auto; border: 1px solid #ccc; }
                    </style>
                </head>
                <body>
                    <div class="merge-container">
                        <div id="${clientIdLocale}_container" class="panel"></div>
                        <div id="${clientIdBase}_container" class="panel""></div>
                        <div id="${clientIdRemote}_container" class="panel"></div>
                    </div>
                    <script src="${webviewScriptSourceUri}"></script> // JavaScript to handle UI logic
                    <script src="${webviewScriptSourceUri2}"></script>
                    <script src="${webviewScriptSourceUri3}"></script>
                </body>
            </html>`;
    }
}
