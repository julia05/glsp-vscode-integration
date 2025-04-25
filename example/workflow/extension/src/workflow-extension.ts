/********************************************************************************
 * Copyright (c) 2021-2024 EclipseSource and others.
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
import 'reflect-metadata';

import { WorkflowDiagramModule, WorkflowLayoutConfigurator, WorkflowServerModule } from '@eclipse-glsp-examples/workflow-server/node';
import { configureELKLayoutModule } from '@eclipse-glsp/layout-elk';
import { GModelStorage, LogLevel, createAppModule } from '@eclipse-glsp/server/node';
import {
    GlspSocketServerLauncher,
    GlspVscodeConnector,
    NavigateAction,
    NodeGlspVscodeServer,
    SocketGlspVscodeServer,
    configureDefaultCommands
} from '@eclipse-glsp/vscode-integration/node';
import { ContainerModule } from 'inversify';
import * as path from 'path';
import * as process from 'process';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import { DiffEditorTracker } from './diff-tracker';
import { DiffParams, asQueryString, getQueryParams } from './query-util';
import WorkflowEditorProvider from './workflow-editor-provider';
import WorkflowMergeEditorProvider from './workflow-merge-editor-provider';

const DEFAULT_SERVER_PORT = '0';
const NODE_EXECUTABLE = path.join(__dirname, '..', 'dist', 'wf-glsp-server-node.js');
const LOG_DIR = process.env.GLSP_LOG_DIR;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Start server process using quickstart component
    let serverProcess: GlspSocketServerLauncher | undefined;
    const useIntegratedServer = JSON.parse(process.env.GLSP_INTEGRATED_SERVER ?? 'false');
    if (!useIntegratedServer && process.env.GLSP_SERVER_DEBUG !== 'true') {
        const additionalArgs = [];
        if (LOG_DIR) {
            additionalArgs.push('--fileLog', 'true', '--logDir', LOG_DIR);
        }
        if (process.env.GLSP_WEBSOCKET_PATH) {
            additionalArgs.push('--webSocket');
        }
        serverProcess = new GlspSocketServerLauncher({
            executable: NODE_EXECUTABLE,
            socketConnectionOptions: { port: JSON.parse(process.env.GLSP_SERVER_PORT || DEFAULT_SERVER_PORT) },
            additionalArgs,
            logging: true
        });

        context.subscriptions.push(serverProcess);
        await serverProcess.start();
    }
    // Wrap server with quickstart component
    const workflowServer = useIntegratedServer
        ? new NodeGlspVscodeServer({
              clientId: 'glsp.workflow',
              clientName: 'workflow',
              serverModules: createServerModules()
          })
        : new SocketGlspVscodeServer({
              clientId: 'glsp.workflow',
              clientName: 'workflow',
              connectionOptions: {
                  port: serverProcess?.getPort() || JSON.parse(process.env.GLSP_SERVER_PORT || DEFAULT_SERVER_PORT),
                  path: process.env.GLSP_WEBSOCKET_PATH
              }
          });
    // Initialize GLSP-VSCode connector with server wrapper
    const glspVscodeConnector = new GlspVscodeConnector({
        server: workflowServer,
        logging: true
    });

    const customEditorProvider = vscode.window.registerCustomEditorProvider(
        'workflow.glspDiagram',
        new WorkflowEditorProvider(context, glspVscodeConnector),
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );

    const customMergeEditorProvider = vscode.window.registerCustomEditorProvider(
        'workflow.mergeGlspDiagram',
        new WorkflowMergeEditorProvider(context, glspVscodeConnector),
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );

    context.subscriptions.push(workflowServer, glspVscodeConnector);
    context.subscriptions.push(customEditorProvider, customMergeEditorProvider);
    workflowServer.start();

    configureDefaultCommands({ extensionContext: context, connector: glspVscodeConnector, diagramPrefix: 'workflow' });

    context.subscriptions.push(
        vscode.commands.registerCommand('workflow.goToNextNode', () => {
            glspVscodeConnector.dispatchAction(NavigateAction.create('next'));
        }),
        vscode.commands.registerCommand('workflow.goToPreviousNode', () => {
            glspVscodeConnector.dispatchAction(NavigateAction.create('previous'));
        }),
        vscode.commands.registerCommand('workflow.showDocumentation', () => {
            glspVscodeConnector.dispatchAction(NavigateAction.create('documentation'));
        }),
        vscode.commands.registerCommand('workflow.compareSelected', (...args) => {
            if (args.length !== 2 && !(args[1] instanceof Array)) {
                return;
            }
            const [leftFile, rightFile] = args[1];
            if (!(leftFile instanceof vscode.Uri && rightFile instanceof vscode.Uri)) {
                return;
            }
            openCompareSelected(leftFile, rightFile);
        }),
        vscode.commands.registerCommand('workflow.openMergeVisualizer', (...args) => {
            console.log('command open merge visualizer triggered', args);
            console.log('--------------------------');
        }),
        vscode.workspace.onDidOpenTextDocument(async document => {
            console.log('OpenTextDocument ', document);
            console.log(`Document opened: ${document.uri.toString()}`);
            console.log(`Scheme: ${document.uri.scheme}`);
            console.log('--------------------------');

            // Check if this is a file we want to handle
            if (document.fileName.endsWith('.wf')) {
                const text = document.getText();

                if (text.includes('<<<<<<< HEAD') || text.includes('=======') || text.includes('>>>>>>>')) {
                    // first variant only with one custom editor all 3 files
                    await vscode.commands.executeCommand('vscode.openWith', document.uri, 'workflow.mergeGlspDiagram');

                    // second variant webview with 3 iframes
                    /*
                    const panel = vscode.window.createWebviewPanel(
                        'mergeJuuIframe', // Identifies the type of the webview. Used internally
                        'Merge Conflict Files', // Title of the panel displayed to the user
                        vscode.ViewColumn.One, // Editor column to show the new webview panel in.
                        {
                            // Webview options
                            enableScripts: true,
                            retainContextWhenHidden: true,
                            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'workspace')]
                        }
                    );

                    console.log(context.extensionUri);
                    console.log(panel);

                    panel.webview.html = getWebviewContentIframes(context, glspVscodeConnector, panel, document.uri);
                    */

                    // third option webview with 3 files loaded
                    /*
                    const panel = vscode.window.createWebviewPanel(
                        'mergeJuu', // Identifies the type of the webview. Used internally
                        'Merge Conflict Files', // Title of the panel displayed to the user
                        vscode.ViewColumn.One, // Editor column to show the new webview panel in.
                        {
                            // Webview options
                            enableScripts: true,
                            retainContextWhenHidden: true,
                            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'workspace')]
                        }
                    );

                    console.log(context.extensionUri);
                    console.log(panel);

                    panel.webview.html = await getWebviewContent(context, glspVscodeConnector, panel, document.uri);
                    */
                }
            }
        }),
        DiffEditorTracker.get()
    );
}

const openCompareSelected = (leftFile: vscode.Uri, rightFile: vscode.Uri): void => {
    const diffId = uuid();
    const leftDiffParams: DiffParams = {
        mode: 'diff',
        side: 'left',
        diffId
    };
    const rightDiffParams: DiffParams = {
        mode: 'diff',
        side: 'right',
        diffId
    };

    const diffOriginalUri = leftFile.with({
        query: asQueryString({
            ...getQueryParams(leftFile),
            ...leftDiffParams
        })
    });

    const diffModifiedUri = rightFile.with({
        query: asQueryString({
            ...getQueryParams(leftFile),
            ...rightDiffParams
        })
    });

    vscode.commands.executeCommand('vscode.diff', diffOriginalUri, diffModifiedUri);
};

function createServerModules(): ContainerModule[] {
    const appModule = createAppModule({ logLevel: LogLevel.info, logDir: LOG_DIR, fileLog: true, consoleLog: false });
    const elkLayoutModule = configureELKLayoutModule({ algorithms: ['layered'], layoutConfigurator: WorkflowLayoutConfigurator });
    const mainModule = new WorkflowServerModule().configureDiagramModule(new WorkflowDiagramModule(() => GModelStorage), elkLayoutModule);
    return [appModule, mainModule];
}
