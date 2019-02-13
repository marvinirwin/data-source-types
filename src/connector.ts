import {QuickPickItem} from "vscode";

export interface Features {
    discovery: boolean;
    migration: boolean;
}

export interface Settings {
}

export interface Connector {
    name: string;
    description: string;
    baseModel: string;
    features: Features;
    settings: Settings;
    supportedByStrongLoop: boolean;
    label: string;
    inputs: string[];
    package: any;
}
const conObjects: Connector[] = Object.values(require('temp-marvinirwin-lb4-cli/generators/datasource/connectors.json'));

export const DiscoveryConnectors = conObjects
    .filter((c: Connector) => c.features.discovery)
    .map((c: Connector) => {
        c.label = c.name;
        c.inputs = Object.keys(c.settings || {});
        return c;
    });
