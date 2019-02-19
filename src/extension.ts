/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
import {window, commands, ExtensionContext} from 'vscode';
import {Connector, DiscoveryConnectors} from "./connector";
import {DataSource} from "loopback-datasource-juggler";
import * as vscode from "vscode";
import * as path from "path";
import {CreateClass} from "./typescript";

const npm = require("npm");
const fs = require('fs-extra');

const defaultFile = '.DataSourceTypes.json';

export function resolveBasicFilename(fn = defaultFile) {
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('Please open a project');
    }
    if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders.length) {
        console.log("No workspace folders");
        return '/Users/frodo/Desktop/vscode/data-source-types/' + fn;
    }
    console.log(`First folder ${JSON.stringify(vscode.workspace.workspaceFolders[0].uri)}`);
    // @ts-ignore
    if (!vscode.workspace.workspaceFolders[0]) {
        return fn;
    }
    // @ts-ignore
    return path.join(vscode.workspace.workspaceFolders[0].uri.path, fn);
}

export const defaultModelFolder = 'models';

enum SupportedLanguages {
    typescript = 'TYPESCRIPT',
    go = 'GO',
    cSharp = 'C#',
    java = 'JAVA',
    kotlin = 'KOTLIN',
    cPlusPlus = 'C++',
    javascript = 'JAVASCRIPT',
    python = 'PYTHON',
}

interface Config {
    modelFolder?: string | undefined;
    dataSources?: { [key: string]: KV };
    language?: SupportedLanguages;
}

interface KV {
    name: string;

    [key: string]: any;
}

interface DsSettings {
    name: string;
    connector: string;
    ds: DataSource | undefined;

    [key: string]: any;
}

export function activate(context: ExtensionContext) {

    context.subscriptions.push(commands.registerCommand('DataSourceTypes.RegisterDataSource', async () => {
        /*		const options: { [key: string]: (context: ExtensionContext) => Promise<void> } = {
                };*/
        // first ask which ds you want
        try {
            const connector = await window.showQuickPick(DiscoveryConnectors);
            if (!connector) {
                return;
            }

            const dsName = await window.showInputBox({prompt: 'Data Source Name', placeHolder: 'myDataSource'});
            const dsSettings: KV = {name: dsName || ''};
            if (!dsName) {
                return;
            }

            for (let i = 0; i < connector.inputs.length; i++) {
                const input = connector.inputs[i];
                dsSettings[input] = await window.showInputBox({prompt: input, placeHolder: input});
            }
            writeNewDsConfig(resolveBasicFilename(), dsSettings);
        } catch (e) {
            vscode.window.showErrorMessage(e);
        }
    }));

    context.subscriptions.push(commands.registerCommand('DataSourceTypes.DiscoverTypes', async () => {
        try {
            await discoverTypes();
        } catch (e) {
            vscode.window.showErrorMessage(e);
        }
    }));
}

const dir = 'discovered-types';

export async function discoverTypes() {
    try {
        fs.ensureDirSync(resolveBasicFilename(dir));
        const dsSettings = await loadAllDataSources();
        console.log(`returned settings length: ${dsSettings.length}`);
        for (let i = 0; i < dsSettings.length; i++) {
            try {
                const dsSetting = dsSettings[i];
                if (!dsSetting.ds) {
                    vscode.window.showInformationMessage(`Datasource not found in settings ${JSON.stringify(dsSettings)}`);
                    continue;
                }
                const models = await generateDsModels(dsSetting.ds);
                vscode.window.showInformationMessage(`Writing ${models.length} models from ${dsSetting.name}`)
                for (let j = 0; j < models.length; j++) {
                    try {
                        const model = models[j];
                        const fPath = path.join(resolveBasicFilename(dir), model.filename);
                        fs.writeFileSync(fPath, model.tsClass);
                    }catch(e) {
                        vscode.window.showErrorMessage(e);
                    }
                }
            } catch (e) {
                vscode.window.showErrorMessage(e);
            }
        }
    } catch (e) {
        vscode.window.showErrorMessage(e);
    }
    vscode.window.showInformationMessage(`Done!`);
}

export async function loadAllDataSources(): Promise<DsSettings[]> {
    console.log(`Loading datasources from file`);
    // First load the config file
    if (!fs.existsSync(resolveBasicFilename())) {
        throw new Error(`${resolveBasicFilename()} not found!`);
    }
    const settingsConfig: DsSettings[] = Object.values(JSON.parse(fs.readFileSync(resolveBasicFilename()).toString()).dataSources);
    window.showInformationMessage(`Loading ${settingsConfig.length} DataSources`);
    for (let i = 0; i < settingsConfig.length; i++) {
        const dataSourceSettings = settingsConfig[i];
        const c = DiscoveryConnectors.find(c => c.name === dataSourceSettings.connector);
        if (!c) {
            throw new Error(`Connector not found: ${dataSourceSettings.connector}`);
        }
        await ensureConnector(c);

        vscode.window.showInformationMessage(`Connecting to ${dataSourceSettings.name}...`);
        dataSourceSettings.ds = new DataSource(dataSourceSettings);
        dataSourceSettings.ds.connect();
        await awaitDsConnect(dataSourceSettings.ds);
        vscode.window.showInformationMessage(`Successfully connected to ${dataSourceSettings.name}!`);
    }
    return settingsConfig;
}

interface ModelDefStruct {
    filename: string;
    tsClass: string;
    schemaDef: any;
}

export async function generateDsModels(ds: DataSource): Promise<ModelDefStruct[]> {
    const modelNames = await ds.discoverModelDefinitions({views: true});
    if (!modelNames) {
        throw new Error('Discovery yielded undefined instead of array of definitions');
    }
    console.log(`modelNames length: ${modelNames.length}`);
    if (!modelNames) {
        throw Error('discoverModelDefinitions returned undefined?');
    }
    const models: ModelDefStruct[] = [];
    for (let i = 0; i < modelNames.length; i++) {
        // @ts-ignore
        const modelName = modelNames[i];
        // console.log(JSON.stringify(modelName));
        // @ts-ignore
        modelName.properties = await ds.discoverModelProperties(modelName.name);
        console.log(JSON.stringify(modelName), null, '\t');
        // console.log(JSON.stringify(def));
        // @ts-ignore
        models.push({schemaDef: modelName, tsClass: CreateClass(modelName), filename: modelName.name + '.ts'});
        console.log(`Models length ${models.length}`);
    }

    console.log(`Returned models length: ${models.length}`);
    return models;
}

export function writeNewDsConfig(filename: string, newKv: KV) {
    let o: Config;
    console.log(newKv);
    const exists = fs.existsSync(filename);
    vscode.window.showInformationMessage(`${filename} exists: ${exists}`);
    if (exists) {
        o = JSON.parse(fs.readFileSync(filename).toString());
        o.dataSources = o.dataSources || {};
        o.dataSources[newKv.name] = newKv;
    } else {
        o = {dataSources: {}};
        // @ts-ignore
        o.dataSources[newKv.name] = newKv;
    }
    fs.writeFileSync(filename, JSON.stringify(o, null, '\t'));
    vscode.window.showInformationMessage(`${newKv.name} registered`);
}

export async function ensureConnector(connector: Connector) {
    let p;
    if (!connector.package) {
        console.log(`${connector.name} does not have a connector, assume we don't have to load`);
        return;
    }
    try {
        p = require(connector.package.name);
    } catch (e) {
        try {
            vscode.window.showErrorMessage(e);
            await npmInstall(connector.package.name);
            p = require(connector.package.name);
        } catch (e) {
            throw e;
        }
    }


}

export function npmInstall(name: string) {
    return new Promise(((resolve, reject) => {
        npm.load({
            loaded: false
        }, function (err: Error) {
            if (err) {
                reject(err);
            }
            // catch errors
            npm.commands.install([name], function (er: Error, data: any) {
                if (er) {
                    reject(err);
                }
                console.log(data);
            });
            npm.on("log", function (message: string) {
                // log the progress of the installation
                console.log(message);
            });
        });
    }));
}

export function awaitDsConnect(ds: DataSource) {
    return new Promise(((resolve, reject) => {
        if (ds.connected) {
            resolve();
        }
        ds.on('connected', resolve);
    }));
}


