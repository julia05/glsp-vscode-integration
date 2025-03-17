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

    context.subscriptions.push(workflowServer, glspVscodeConnector, customEditorProvider);
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
            console.log('haaalllooo ', args);
            console.log('--------------------------');
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                console.log(`Active editor changed: ${editor.document.uri.toString()}`);
                console.log(`Scheme: ${editor.document.uri.scheme}`);
                console.log('--------------------------');
            }
            if (editor && editor.document.uri.scheme === 'merge-editor') {
                console.log('byyyyeeee ');
            }
        }),
        vscode.workspace.onDidOpenTextDocument(document => {
            console.log('OpenTextDocument');
            console.log(document);
            console.log(`Document opened: ${document.uri.toString()}`);
            console.log(`Scheme: ${document.uri.scheme}`);
            console.log('--------------------------');
            if (document.uri.scheme === 'merge-editor') {
                console.log('goooood luuuuck ');
                console.log('Merge editor document was opened');
            }
        }),
        vscode.tasks.onDidStartTask(taskstart => {
            console.log('taskstart ');
            console.log(taskstart.execution);
            console.log('--------------------------');
        }),
        vscode.window.tabGroups.onDidChangeTabs(e => {
            console.log('tabGroups - ChangeTab ');
            console.log(e);
            console.log('--------------------------');
        }),
        DiffEditorTracker.get()
    );
}

const openCompareSelected = (leftFile: vscode.Uri, rightFile: vscode.Uri) => {
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
