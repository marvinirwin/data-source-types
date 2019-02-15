import * as ejs from 'ejs';
export function CreateClass(schemaDef: any) {
    // TODO assign columnNames here
    return ejs.renderFile('./go.ejs', schemaDef);
}
