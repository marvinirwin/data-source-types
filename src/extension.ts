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
        throw new Error('Please open a project!');
    }
    if (!vscode.workspace.workspaceFolders[0]) {
        return fn;
    }
    return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, fn);
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

function delim(d: string) {
    return function kebab(s: string) {
        return s.replace(/([A-Z])([A-Z])/g, `$1${d}$2`)
            .replace(/([a-z])([A-Z])/g, `$1${d}$2`)
            .replace(/[\s_]+/g, `${d}`)
            .toLowerCase();
    };
}
const underscore = delim('_');
const kebab = delim('-');

function camel(s: string) {
    return s.replace(/(?:^\w|[A-Z]|\b\w)/g, function (letter, index) {
        return index === 0 ? letter.toLowerCase() : letter.toUpperCase();
    }).replace(/\s+/g, '');
}

function pascal(s: string) {
    return s.replace(/(\w)(\w*)/g,
        function (g0, g1, g2) {
            return g1.toUpperCase() + g2.toLowerCase();
        });
}

enum TextCase {
    PASCAL='pascal',
    CAMEL='camel',
    KEBAB='kebab',
    UNDERSCORE='underscore',
    SNAKE='snake',
}

function transformString(s: string, c: TextCase) {
    let r = '';
    switch (c) {
        case TextCase.CAMEL:
            r = camel(s);
            break;
        case TextCase.PASCAL:
            r = pascal(s);
            break;
        case TextCase.KEBAB:
            r = kebab(s);
            break;
        case TextCase.UNDERSCORE:
        case TextCase.SNAKE:
            r = underscore(r);
            break;
        default:
            throw new Error(`Unknown case ${c}`);
    }

    return r;
}


interface Config {
    modelFolder?: string | undefined;
    filenameCase?: string | undefined;
    classCase?: string | undefined;
    propertyCase: string | undefined;
    dataSources?: { [key: string]: KV };
    schemas?: string[];
    language?: SupportedLanguages;
}

interface KV {
    name: string;
    schemas?: string[];

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

            const dsName = await window.showInputBox({
                prompt: 'Data Source Name',
                placeHolder: 'myDataSource',
                value: connector.label
            });
            const dsSettings: KV = {name: dsName || ''};
            if (!dsName) {
                return;
            }

            for (let i = 0; i < connector.inputs.length; i++) {
                const input = connector.inputs[i];
                dsSettings[input] = await window.showInputBox({prompt: input, placeHolder: input});
            }

            dsSettings.schemas = [];
            let schemaInput: string | undefined = '';
            do {
                if (schemaInput) {
                    dsSettings.schemas.push(schemaInput);
                }
                schemaInput = await window.showInputBox({prompt: '(Optional) Schema?'});
            } while (schemaInput !== '');
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
        const p = resolveBasicFilename(dir);
        fs.ensureDirSync(p);

        const conf: Config = await loadConfig();
        const globalSchemas = conf.schemas || [];
        const globalFilenameCase: TextCase = conf.filenameCase || TextCase.KEBAB;
        const globalClassCase: TextCase = conf.classCase || TextCase.PASCAL;
        const globalPropertyCase = conf.propertyCase || TextCase.CAMEL;
        const dataSourceList = Object.values(conf.dataSources || {});
        vscode.window.showInformationMessage(`Loaded ${dataSourceList.length} DataSources`);
        for (let i = 0; i < dataSourceList.length; i++) {
            try {
                const dataSource = dataSourceList[i];
                if (!dataSource.ds) {
                    vscode.window.showInformationMessage(`Datasource not found in settings ${JSON.stringify(dataSourceList)}`);
                    continue;
                }
                const localSchemas = dataSource.schemas && dataSource.schemas.length && dataSource.schemas;
                const localFilenameCase: TextCase = dataSource.filenameCase;
                const localClassCase: TextCase = dataSource.classCase;
                const localPropertyCase: TextCase = dataSource.propertyCase;

                const schemas = localSchemas || globalSchemas;
                const models = [];
                if (schemas && schemas.length) {
                    for (let j = 0; j < schemas.length; j++) {
                        const schema = schemas[j];
                        models.push(...(await generateDsModels(dataSource.ds, schema)));
                    }
                } else {
                    models.push(...(await generateDsModels(dataSource.ds)));
                }
                vscode.window.showInformationMessage(`Writing ${models.length} models from ${dataSource.name}`);
                for (let j = 0; j < models.length; j++) {
                    const model = models[j];
                    model.filename = transformString(model.schemaDef.name, localFilenameCase || globalFilenameCase);
                }
                writeModels(models);
            } catch (e) {
                vscode.window.showErrorMessage(e.message);
            }
        }
    } catch (e) {
        console.log(e);
        vscode.window.showErrorMessage(e.message);
    }
    vscode.window.showInformationMessage(`Done!`);
}

export async function writeModels(models: ModelDefStruct[]) {
    for (let j = 0; j < models.length; j++) {
        try {
            const model = models[j];
            const fPath = path.join(resolveBasicFilename(dir), model.filename);
            fs.writeFileSync(fPath, model.tsClass);
        } catch (e) {
            vscode.window.showErrorMessage(e.Message);
        }
    }
}

export async function loadConfig(): Promise<Config> {
    console.log(`Loading datasources from file`);
    // First load the config file
    if (!fs.existsSync(resolveBasicFilename())) {
        throw new Error(`${resolveBasicFilename()} not found!`);
    }
    const conf: Config = JSON.parse(fs.readFileSync(resolveBasicFilename()).toString()).dataSources;
    const settingsConfig: DsSettings[] = Object.values(conf);
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
    return conf;
}

interface ModelDefStruct {
    filename: string;
    tsClass: string;
    schemaDef: any;
}

export async function generateDsModels(ds: DataSource, schema?: string): Promise<ModelDefStruct[]> {
    const modelNames = await ds.discoverModelDefinitions({views: true, schema});
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
        vscode.window.showInformationMessage(`Installing ${name}`);
        npm.load({
            loaded: false
        }, function (err: Error) {
            if (err) {
                reject(err);
            }
            npm.commands.install([name], function (er: Error, data: any) {
                if (er) {
                    reject(err);
                }
                vscode.window.showInformationMessage(`Installed ${name} successfully`);
                resolve();
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


