import ts = require('typescript');
import * as fs from 'fs';
import * as path from 'path';


function TitleCaseToKebabCase(s: string): string {
    let result = s.replace(/([A-Z])([A-Z])/g, '$1-$2')
        .replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    return result;
}
function snakeToCamel(s: string){
    return s.replace(/(\_\w)/g, function(m){return m[1].toUpperCase();});
}

function cloneObject(obj: any): ts.PropertyAssignment[] {
    const components: ts.PropertyAssignment[] = [];
    Object.keys(obj).map(k => {
        const prop = obj[k];

        // It's not called options anymore
        if (k === 'options') {
            k = 'settings';
        }
        if (!prop) {
            // Do nothing
        }
        else if (Array.isArray(prop)) {
            // TODO figure out what to do here
            /*      components.push(ts.createPropertyAssignment(k,
                    ts.createArrayLiteral(cloneObject(prop))
                  ))*/
        } else
        if (typeof prop === 'object') {
            const n = ts.createObjectLiteral(cloneObject(prop));
/*            console.log(nodeText(n));*/
            components.push(ts.createPropertyAssignment(k,n))
        } else {
            // !!! It will get mad if I make id: 1, I must do id = true
            const literal = k === 'id' ? ts.createLiteral(!!prop) : ts.createLiteral(prop);
/*            console.log(nodeText(literal));*/
            components.push(ts.createPropertyAssignment(k, literal))
        }
    });
    return components;
}

function getModelDecorator(json: any) {
    // Copy over the options
    const obj = ts.createObjectLiteral(cloneObject({options: json.options}));
    const p = ts.createIdentifier('model');
    const call = ts.createCall(p, undefined, [obj]);
    // Now let's build the object literal
    return ts.createDecorator(call);
}

function nodeTexts(n: ts.Node[]): string[] {
    return n.map(nodeText);
}

function nodeText(n: ts.Node): string {
    const resultFile = ts.createSourceFile(
        'test.ts',
        '',
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.TS,
    );
    const printer = ts.createPrinter({
        newLine: ts.NewLineKind.LineFeed,
    });
    const result = printer.printNode(
        ts.EmitHint.Unspecified,
        n,
        resultFile,
    );
    return result;
}

function getPropertyTsType(prop: any): ts.TypeReferenceNode {
    let isOptional = prop.nullable === 'YES' ? '|undefined' : '';
    let t;
    switch (prop.type) {
        case 'String':
            t=  'String';
            break;
        case 'Number':
            t=  'Number';
            break;
        case 'Date':
            t=  'Date';
            break;
        case 'Boolean':
            t=  'Boolean';
            break;
        default:
            throw new Error('Unknown type ' + prop.type);
    }
    return ts.createTypeReferenceNode(t + isOptional, []);
}

function getPropertyDecorators(prop: any, key: string): ts.Decorator[] {
    const decorators: ts.Decorator[] = [];
    const p = ts.createIdentifier('property');
    const cloneSettings = cloneObject(prop);
    let call;
    if ((prop.id || key === 'id') && !prop.id) {
        const idAssignment = ts.createPropertyAssignment('id', ts.createLiteral(true));
        const literal = [ts.createObjectLiteral([...cloneSettings, idAssignment])];
        call = ts.createCall(p, undefined, literal);
    } else {
        call = ts.createCall(p, undefined, [ts.createObjectLiteral(cloneSettings)]);
    }
    decorators.push(ts.createDecorator(call));
    return decorators;
}

function getModelClass(json: any): ts.Node[] {
    const name: string = json.name;
    const members: ts.ClassElement[] = [];
    json.properties.forEach((v: any) => {
        const prop = ts.createProperty(
            undefined,
            [],
            snakeToCamel(v.columnName),
            undefined,
            getPropertyTsType(v),
            undefined
        );
        members.push(prop);
    });
/*    const partialType = ts.createTypeReferenceNode('Partial', [ts.createTypeReferenceNode(name, undefined)]);*/
    // Now create the constructor
/*    const dataId = ts.createIdentifier('data');
    const param = ts.createParameter(undefined, undefined, undefined, dataId, ts.createToken(ts.SyntaxKind.QuestionToken), partialType);
    const sup = ts.createSuper();
    const superCall = ts.createCall(sup, undefined, [dataId]);
    const statement = ts.createExpressionStatement(superCall);
    const block = ts.createBlock([statement], true);
    const cons = ts.createConstructor(undefined, undefined, [param], block);*/
/*    members.push(cons);*/

    // create the extension
/*    const ent = ts.createIdentifier('Entity');
    const expres = ts.createExpressionWithTypeArguments(undefined, ent);
    const ext = ts.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [expres]);*/

    // const cls = ts.createClassDeclaration([getModelDecorator()], [], json.name, [], [ext], members);
    ts.createClassExpression([], json.name, [], [/*ext*/], members);
    const classDec = ts.createClassDeclaration([/*getModelDecorator(json)*/], [
        ts.createToken(ts.SyntaxKind.ExportKeyword),
    ], json.name, [], [/*ext*/], members);
    return [classDec];
}

function getModelImport(): ts.ImportDeclaration {

    const mId = ts.createIdentifier('model');
    const pId = ts.createIdentifier('property');
    const eId = ts.createIdentifier('Entity');

    const model = ts.createImportSpecifier(mId, mId);
    const property = ts.createImportSpecifier(pId, pId);
    const Entity = ts.createImportSpecifier(eId, eId);

    const imports = ts.createNamedImports([model, property, Entity]);
    const i = ts.createImportClause(undefined, imports);

    const namedImports = ts.createImportDeclaration([], [], i, ts.createStringLiteral('@loopback/repository'));

    return namedImports;
}

export function CreateTsClass(schemaDef: any) {
/*    console.log(JSON.stringify(schemaDef));*/
    try {
        return nodeTexts([...getModelClass(schemaDef)]).join('\n');
    }catch(e) {
        console.error(e);
        return '';
    }
}

