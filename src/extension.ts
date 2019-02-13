/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
import { window, commands, ExtensionContext } from 'vscode';
import {Connector, DiscoveryConnectors} from "./connector";
import {DataSource} from "loopback-datasource-juggler";
import {CreateTsClass} from './typescript';
import * as vscode from "vscode";
import * as path from "path";

const npm = require("npm");
const fs = require('fs-extra');

const defaultFile = '.DataSourceTypes.json';
export function resolveBasicFilename(fn=defaultFile) {
    if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders.length) {
    	console.log("No workspace folders");
    	return '/Users/frodo/Desktop/vscode/data-source-types/' + fn;
	}
    console.log(`First folder ${JSON.stringify(vscode.workspace.workspaceFolders[0].uri)}`);
	// @ts-ignore
	if (!vscode.workspace.workspaceFolders[0]) { return fn; }
	// @ts-ignore
	return path.join(vscode.workspace.workspaceFolders[0].uri.path, fn);
}
export const defaultModelFolder = 'models';

interface Config {
    modelFolder: string | undefined;
    dataSources: {[key: string]: KV};

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
		const connector = await window.showQuickPick(DiscoveryConnectors);
		if (!connector) {return}

		const dsName = await window.showInputBox({prompt: 'Data Source Name', placeHolder: 'myDataSource'});
		const dsSettings: KV = {name: dsName || ''};
		if (!dsName) return;

		for (let i = 0; i < connector.inputs.length; i++) {
			const input = connector.inputs[i];
			dsSettings[input] = await window.showInputBox({prompt: input, placeHolder: input});
		}
		writeNewDsConfig(resolveBasicFilename(), dsSettings);
	}));

	context.subscriptions.push(commands.registerCommand('DataSourceTypes.DiscoverTypes', async () => {
	    await discoverTypes();
	}));
}

const dir = 'discovered-types';
export async function discoverTypes() {
    fs.ensureDirSync(resolveBasicFilename(dir));
	const dsSettings = await loadAllDataSources();
	console.log(`returned settings length: ${dsSettings.length}`);
	for (let i = 0; i < dsSettings.length; i++) {
		const dsSetting = dsSettings[i];
		if (!dsSetting.ds) {
			console.log(`Datasource not found in settings ${JSON.stringify(dsSettings)}`);
			continue;
		}
		console.log(`Generating ds models for ${dsSetting.name}`);
		// @ts-ignore
		const models = await generateDsModels(dsSetting.ds);
		console.log(`Models length: ${models.length}`);
		for (let j = 0; j < models.length; j++) {
			const model = models[j];
			const fPath = path.join(resolveBasicFilename(dir), model.filename);
			console.log(`Writing ${fPath}`);
			fs.writeFileSync(fPath, model.tsClass);
		}
	}
}

export async function loadAllDataSources(): Promise<DsSettings[]> {
	console.log(`Loading datasources from file`);
	// First load the config file
	if (!fs.existsSync(resolveBasicFilename())) {
		await window.showErrorMessage(`${resolveBasicFilename()} not found!`);
		return [];
	}
	const settingsConfig: DsSettings[] = Object.values(JSON.parse(fs.readFileSync(resolveBasicFilename()).toString()).dataSources);
	console.log(`settingsConfig.length: ${settingsConfig.length}`);
	for (let i = 0; i < settingsConfig.length; i++) {
		const dataSourceSettings = settingsConfig[i];
		const c = DiscoveryConnectors.find(c => c.name === dataSourceSettings.connector);
		if (!c) {
			throw new Error(`Discovery connected not found: ${dataSourceSettings.connector}`);
		}
		console.log(`Ensuring connector ${c}`);
		await ensureConnector(c);

		// TODO figure out if this will work
		console.log(`Connecting to ds ${dataSourceSettings.name}...`);
		dataSourceSettings.ds = new DataSource(dataSourceSettings);
		dataSourceSettings.ds.connect();
		await awaitDsConnect(dataSourceSettings.ds);
		console.log(`Connected to ${dataSourceSettings.name}`);

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
		models.push({schemaDef: modelName, tsClass: CreateTsClass(modelName), filename: modelName.name + '.ts'});
		console.log(`Models length ${models.length}`);
	}

	console.log(`Returned models length: ${models.length}`);
	return models;
}

export function writeNewDsConfig(filename: string, newKv: KV) {
	const exists =  fs.existsSync(filename);
	console.log(`${filename} exists: ${exists}`);
	if (exists) {
		console.log(`${filename} exists`);
		const o: Config = JSON.parse(fs.readFileSync(filename).toString());
		o.dataSources = o.dataSources || {};
		o.dataSources[newKv.name] = newKv;
		console.log(`Writing ${filename} `);
		fs.writeFileSync(filename, JSON.stringify(o));
	}else {
		console.log(`Writing ${filename} `);
		fs.writeFileSync(filename, JSON.stringify({dataSources: [newKv]}));
	}
}

export async function ensureConnector(connector: Connector) {
    let p;
	if (!connector.package) {
		console.log(`${connector.name} does not have a connector, assume we don't have to load`);
		return;
	}
	try {
		 p= require(connector.package.name);
	} catch(e) {
	    console.error(e);
		await npmInstall(connector.package.name);
		p = require(connector.package.name);
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
				if (er) {reject(err)}
				console.log(data);
			});
			npm.on("log", function (message: string) {
				// log the progress of the installation
				console.log(message);
			});
		});
	}))
}

export function awaitDsConnect(ds: DataSource) {
	return new Promise(((resolve, reject) => {
		if (ds.connected) {
			resolve();
		}
		ds.on('connected', resolve);
	}));
}

