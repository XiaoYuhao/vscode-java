

import * as vscode from "vscode";
import { ExtensionContext, window, commands, Uri, Position, Location, Selection } from "vscode";
import { Commands } from "./commands";
import { apiManager } from "./apiManager";
import { supportsLanguageStatus } from "./languageStatusItemFactory";
import { ACTIVE_BUILD_TOOL_STATE } from "./settings";
import { getJavaConfiguration } from "./utils";
import htmlparser2 = require("htmlparser2");

export const JAVA_LOMBOK_VERSION = "java.lombokVersion";

export const JAVA_LOMBOK_IMPORTED = "java.importLombok";

export const JAVA_LOMBOK_PATH = "java.lombokPath";

const languageServerDocumentSelector = [
	{ scheme: 'file', language: 'java' },
	{ scheme: 'jdt', language: 'java' },
	{ scheme: 'untitled', language: 'java' },
	{ pattern: '**/pom.xml' },
	{ pattern: '**/{build,settings}.gradle'},
	{ pattern: '**/{build,settings}.gradle.kts'}
];

let hasLombokChangeVersionCommand: boolean = false;
const lombokSupportEnable: boolean = vscode.workspace.getConfiguration().get("java.jdt.ls.lombokSupport.enabled");

export function enableLombokSupport(): boolean {
	return lombokSupportEnable;
}

export function importedLombok(context : ExtensionContext): boolean {
	return context.workspaceState.get(JAVA_LOMBOK_IMPORTED);
}

export function getLombokVersion(context : ExtensionContext) : string {
	let reg = /lombok-.*\.jar/;
	const lombokVersion = reg.exec(context.workspaceState.get(JAVA_LOMBOK_VERSION))[0].split('.jar')[0];
	return lombokVersion;
}

export function addLombokParam(context : ExtensionContext, params : string[]) {
	context.workspaceState.update(JAVA_LOMBOK_VERSION, "");
	if(context.workspaceState.get(JAVA_LOMBOK_IMPORTED)==true){
		// Exclude user setting lombok agent parameter
		var reg = /[\\|/]lombok.*\.jar/
		var deleteIndex = []
		for(var i=0;i<params.length;i++){
			if(reg.test(params[i])){
				deleteIndex.push(i);
			}
		}
		for(var i=0;i<deleteIndex.length;i++){
			params.splice(deleteIndex[i], 1);
		}
		// add -javaagent arg to support lombok
		const lombokAgentParam = '-javaagent:' + context.workspaceState.get(JAVA_LOMBOK_PATH);
		params.push(lombokAgentParam);
		context.workspaceState.update(JAVA_LOMBOK_VERSION, context.workspaceState.get(JAVA_LOMBOK_PATH));
	}
}

export async function checkLombokDependency(context: ExtensionContext){
	/*let impormLombok = context.workspaceState.get("java.importLombok");
	if(impormLombok==true){
		// for test
		context.workspaceState.update("java.importLombok", false);
		return;
	}*/
	let reg = /lombok-.*\.jar/;
	let needReload = false
	let versionChange = false
	let currentLombokVersion = ""
	let previousLombokVersion = ""
	const projectUris: string[] = await commands.executeCommand<string[]>(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.GET_ALL_JAVA_PROJECTS);
	for(var i = 0; i<projectUris.length; i++){
		const classpathResult = await apiManager.getApiInstance().getClasspaths(projectUris[i], {scope: 'runtime'});
		console.log(classpathResult)
		for(var j = 0; j < classpathResult.classpaths.length; j++){
			let classpath = classpathResult.classpaths[j];
			console.log(classpath);
			if(reg.test(classpath)){
				console.log(classpath);
				if(context.workspaceState.get(JAVA_LOMBOK_IMPORTED)==true){
					currentLombokVersion = reg.exec(classpath)[0];
					previousLombokVersion = reg.exec(context.workspaceState.get(JAVA_LOMBOK_PATH))[0];
					console.log("CurrentLombokVersion:" + currentLombokVersion);
					console.log("PreviousLombokVersion:" + previousLombokVersion);
					if(currentLombokVersion!=previousLombokVersion){
						needReload = true;
						versionChange = true;
						context.workspaceState.update(JAVA_LOMBOK_PATH, classpath);
					}
				}
				else{
					needReload = true;
					context.workspaceState.update(JAVA_LOMBOK_IMPORTED, true);
					context.workspaceState.update(JAVA_LOMBOK_PATH, classpath);
				}
				break;
			}
		}
		if(needReload){
			break;
		}
	}
	if(needReload){
		if(versionChange){
			const msg = `Lombok version changed from ${previousLombokVersion.split('.jar')[0].split('-')[1]} to ${currentLombokVersion.split('.jar')[0].split('-')[1]} \
								. Do you want to restart Java Language Server for new version Lombok support?`;
			const action = 'Restart';
			//const restartId = Commands.RELOAD_WINDOW;
			const restartId = Commands.RESTART_LANGUAGE_SERVER;
			window.showInformationMessage(msg, action).then((selection) => {
				if (action === selection) {
					commands.executeCommand(restartId);
				}
			});
		}
		else{
			const msg = `Do you want to restart Java Language Server for Lombok support?`;
			const action = 'Restart';
			//const restartId = Commands.RELOAD_WINDOW;
			const restartId = Commands.RESTART_LANGUAGE_SERVER;
			window.showInformationMessage(msg, action).then((selection) => {
				if (action === selection) {
					commands.executeCommand(restartId);
				}
			});
		}
	}
}

export function addLombokChangeVersionCommand(context : ExtensionContext) {
	if(hasLombokChangeVersionCommand){
		return;
	}
	context.subscriptions.push(commands.registerCommand(Commands.LOMBOK_CONFIGURE, async (buildFilePath: string) => {
		await commands.executeCommand(Commands.OPEN_BROWSER, Uri.file(buildFilePath));
		let fullText = window.activeTextEditor.document.getText();
		if(isMavenProject(buildFilePath)){
			let pos = 0;
			let tagList : [string, number][] = [];
			const parser = new htmlparser2.Parser({
				onopentag(name, attributes) {
					if(name=="dependency"||tagList.length>0){
						tagList.push([name, parser.startIndex]);
					}
				},
				ontext(text) {
					if(tagList.length>0){
						tagList.push([text, parser.startIndex]);
					}
				},
				onclosetag(name) {
					if(name=="dependency"){
						tagList.push([name, parser.startIndex]);
						let hasLombok = false;
						let hasVersion = false;
						let versionIndex = -1;
						for(let i=0;i<tagList.length-1;i++){
							if(tagList[i][0]=="artifactid"&&tagList[i+1][0]=="lombok"){
								hasLombok = true;
							}
							if(tagList[i][0]=="version"){
								hasVersion = true;
								versionIndex = tagList[i+1][1];
							}
						}
						if(hasLombok&&hasVersion){
							pos = versionIndex;
							parser.end();
						}
						tagList = []
					}
				},
			});
			parser.write(fullText);
			parser.end();
			if(pos>0){
				gotoLombokConfigure(pos, buildFilePath);
			}
		}
		else if(isGradleProject(buildFilePath)){
			const deleteCommentReg = /\/\/.*|(\/\*[\s\S]*?\*\/)/g;
			const content = fullText.replace(deleteCommentReg, (match) => {
				let newString = '';
				for(let i=0;i<match.length;i++){
					newString += '@';
				}
				return newString;
			});
			//let lombokReg = /org.projectlombok:lombok:/;
			let lombokReg = /org.projectlombok/;
			const result = lombokReg.exec(content);
			if(result){
				let pos = result.index;
				gotoLombokConfigure(pos, buildFilePath);
			}
		}
	}));
	hasLombokChangeVersionCommand = true;
}

export namespace LombokVersionItemFactory {
	export function create(text: string, buildFilePath: string): any {
		if(supportsLanguageStatus()) {
			const item = vscode.languages.createLanguageStatusItem("javaLombokVersionItem", languageServerDocumentSelector);
			item.severity = vscode.LanguageStatusSeverity?.Information;
			item.name = "Lombok Version";
			item.text = text;
			console.log("LombokVersionItem create text : " + text);
			if(buildFilePath){
				item.command = getLombokChangeCommand(buildFilePath);
			}
			return item;
		}
		return undefined;
	}

	export function update(item: any, text: string, buildFilePath: string): void {
		console.log("LombokVersionItem update text : " + text);
		item.text = text;
		if(buildFilePath){
			item.command = getLombokChangeCommand(buildFilePath);
		}
	}

	function getLombokChangeCommand(buildFilePath: string): vscode.Command {
		const relativePath = vscode.workspace.asRelativePath(buildFilePath);
		return {
			title: `Change Verison`,
			command: Commands.LOMBOK_CONFIGURE,
			arguments: [buildFilePath],
			tooltip: `Open ${relativePath}`
		};
	}
}

function gotoLombokConfigure(position: number, buildFilePath: string): void {
	let newPosition = window.activeTextEditor.document.positionAt(position);
	let newSelection = new Selection(newPosition, newPosition);
	window.activeTextEditor.selection = newSelection;
	let newLocation = new Location(Uri.file(buildFilePath), newPosition);
	commands.executeCommand(
		Commands.GOTO_LOCATION,
		window.activeTextEditor.document.uri,
		window.activeTextEditor.selection.active,
		[newLocation],
		'goto'
	);
}

function isMavenProject(buildFilePath: string): boolean {
	const buildFileNames = ["pom.xml"];
	for (const buildFileName of buildFileNames) {
		if(buildFilePath.indexOf(buildFileName)>=0){
			return true;
		}
	}
	return false;
}

function isGradleProject(buildFilePath: string): boolean {
	const buildFileNames = ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"];
	for (const buildFileName of buildFileNames) {
		if(buildFilePath.indexOf(buildFileName)>=0){
			return true;
		}
	}
	return false;
}
