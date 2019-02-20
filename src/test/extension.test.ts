//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as myExtension from '../extension';
import * as fs from "fs";
import {resolveBasicFilename} from "../extension";

// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", async function () {
    if (fs.existsSync(resolveBasicFilename())) {
        fs.unlinkSync(resolveBasicFilename());
    }
    test('should be able to write a new datasource config', async () => {
        myExtension.writeNewDsConfig(myExtension.resolveBasicFilename(), {
            name: 'tst',
            connector: 'mysql',
            host: 'localhost',
            username: 'root',
            password: 'my-secret-pw',
            ds: undefined
        });
    });
    test('should be able to discover the types of the datasource specified in the config', async () => {
        await myExtension.discoverTypes();
    });
});







