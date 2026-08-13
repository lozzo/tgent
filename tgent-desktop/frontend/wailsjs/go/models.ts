export namespace main {
	
	export class ClipboardImage {
	    localPath: string;
	    name: string;
	    size: number;
	    data: string;
	
	    static createFrom(source: any = {}) {
	        return new ClipboardImage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.localPath = source["localPath"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.data = source["data"];
	    }
	}
	export class DesktopStatus {
	    engineReady: boolean;
	    provider: string;
	    quakeEnabled: boolean;
	    quakeShortcut: string;
	    hotkeyAvailable: boolean;
	    hotkeyError?: string;
	    localDaemon: string;
	    localDaemonError?: string;
	    quake: quake.State;
	
	    static createFrom(source: any = {}) {
	        return new DesktopStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.engineReady = source["engineReady"];
	        this.provider = source["provider"];
	        this.quakeEnabled = source["quakeEnabled"];
	        this.quakeShortcut = source["quakeShortcut"];
	        this.hotkeyAvailable = source["hotkeyAvailable"];
	        this.hotkeyError = source["hotkeyError"];
	        this.localDaemon = source["localDaemon"];
	        this.localDaemonError = source["localDaemonError"];
	        this.quake = this.convertValues(source["quake"], quake.State);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LocalTGentAccess {
	    found: boolean;
	    address?: string;
	    name?: string;
	    socketAvailable: boolean;
	    socketPath?: string;
	    authEnabled: boolean;
	    passwordAvailable: boolean;
	    agentId?: string;
	    hubAddr?: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalTGentAccess(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.found = source["found"];
	        this.address = source["address"];
	        this.name = source["name"];
	        this.socketAvailable = source["socketAvailable"];
	        this.socketPath = source["socketPath"];
	        this.authEnabled = source["authEnabled"];
	        this.passwordAvailable = source["passwordAvailable"];
	        this.agentId = source["agentId"];
	        this.hubAddr = source["hubAddr"];
	    }
	}
	export class LocalTGentDiscovery {
	    found: boolean;
	    address?: string;
	    name?: string;
	    socketPath?: string;
	    requiresPassword?: boolean;
	    agentId?: string;
	    hubAddr?: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalTGentDiscovery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.found = source["found"];
	        this.address = source["address"];
	        this.name = source["name"];
	        this.socketPath = source["socketPath"];
	        this.requiresPassword = source["requiresPassword"];
	        this.agentId = source["agentId"];
	        this.hubAddr = source["hubAddr"];
	    }
	}
	export class LocalTGentValidation {
	    ok: boolean;
	    requiresPassword?: boolean;
	    error?: string;
	    agentId?: string;
	    hubAddr?: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalTGentValidation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.requiresPassword = source["requiresPassword"];
	        this.error = source["error"];
	        this.agentId = source["agentId"];
	        this.hubAddr = source["hubAddr"];
	    }
	}
	export class TerminalClipboard {
	    kind: string;
	    text?: string;
	    image?: ClipboardImage;
	
	    static createFrom(source: any = {}) {
	        return new TerminalClipboard(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.text = source["text"];
	        this.image = this.convertValues(source["image"], ClipboardImage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace quake {
	
	export class Rect {
	    x: number;
	    y: number;
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new Rect(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.width = source["width"];
	        this.height = source["height"];
	    }
	}
	export class Settings {
	    heightRatio: number;
	    minHeight: number;
	    alwaysOnTop: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.heightRatio = source["heightRatio"];
	        this.minHeight = source["minHeight"];
	        this.alwaysOnTop = source["alwaysOnTop"];
	    }
	}
	export class State {
	    active: boolean;
	    visible: boolean;
	    bounds: Rect;
	    settings: Settings;
	
	    static createFrom(source: any = {}) {
	        return new State(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.active = source["active"];
	        this.visible = source["visible"];
	        this.bounds = this.convertValues(source["bounds"], Rect);
	        this.settings = this.convertValues(source["settings"], Settings);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

