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

import * as cp from 'child_process';
import * as util from 'util';
import * as vscode from 'vscode';
import { GitExtension, Repository } from './types/git';
const exec = util.promisify(cp.exec);

async function getGitRepo(): Promise<Repository> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (gitExtension === undefined) {
        throw new Error('Git extension not found');
    }

    const api = gitExtension.exports.getAPI(1);

    const repo = api.repositories[0];

    console.log('REPO: ', repo);

    // this is only called (return value void), and after this command the repo.state is loaded
    await repo.status();

    console.log('Repo state after status load: ', repo.state);
    console.log('HEAD: ', repo.state.HEAD);
    console.log('REFS: ', await repo.getRefs({}));
    console.log('Merge Changes: ', repo.state.mergeChanges);

    return repo;
}

async function getRelativePath(repo: Repository, uri: vscode.Uri): Promise<string> {
    // git log --merge gets the conflict commits
    console.log(await repo.log({ path: uri.path }));

    const relativePath = uri.path.replace(repo.rootUri.path, '');
    console.log(relativePath);

    return relativePath;
}

async function runCommand(command: string): Promise<{ stdout: string; stderr: string } | undefined> {
    try {
        return exec(command);
    } catch (e) {
        console.error(e);
    }

    return undefined;
}

export async function getGitFiles(uri: vscode.Uri): Promise<{ base: string; local: string; remote: string }> {
    const repo = await getGitRepo();

    const repoRoot = repo.rootUri.path;
    const relativePath = await getRelativePath(repo, uri);

    const getBase = `git -C ${repoRoot} show :1:.${relativePath}`;
    const getLocal = `git -C ${repoRoot} show :2:.${relativePath}`;
    const getRemote = `git -C ${repoRoot} show :3:.${relativePath}`;

    const base = await runCommand(getBase);
    const local = await runCommand(getLocal);
    const remote = await runCommand(getRemote);

    if (base === undefined || local === undefined || remote === undefined) {
        throw new Error('Could not found Base or Remote');
    } else if (local.stdout.includes('<<<<<<< HEAD') || local.stdout.includes('=======') || local.stdout.includes('>>>>>>>')) {
        throw new Error('-- File is in merge conflict state');
    } else {
        return { base: base.stdout, local: local.stdout, remote: remote.stdout };
    }
}
