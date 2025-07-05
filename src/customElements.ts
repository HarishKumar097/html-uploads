// Define the basic EventHandler interface.
interface EventHandler {
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
    dispatchEvent(event: Event): boolean;
}

interface VideoUploaderElement extends HTMLElement {
    uploadFile(file: File): void;
}

interface ResumableUpload {
    on(event: string, callback: (event: any) => void): void;
    abort(): void;
    pause(): void;
    retryUpload(): void;
    resume(): void;
}

// A default implementation of the EventHandler interface.
class DefaultEventHandler implements EventHandler {
    removeEventListener(_type: string, _listener: EventListenerOrEventListenerObject, _options?: boolean | EventListenerOptions): void { }
    addEventListener(_type: string, _listener: EventListenerOrEventListenerObject, _options?: boolean | AddEventListenerOptions): void { }
    dispatchEvent(_event: Event): boolean { return true; }
}

// Function to create a custom HTMLElement class extending DefaultEventHandler.
function createHTMLElement(): typeof DefaultEventHandler {
    return class extends DefaultEventHandler { };
}

// Function to create a custom DocumentFragment class extending DefaultEventHandler.
function createDocumentFragment(): typeof DefaultEventHandler {
    return class extends DefaultEventHandler { };
}

// Define a CustomElementRegistry with basic methods.
const customElementsRegistry: CustomElementRegistry = {
    get(_name: string) {
        return undefined;
    },
    define(
        _name: string,
        _constructor: CustomElementConstructor,
        _options?: ElementDefinitionOptions
    ) { },
    upgrade(_root: Node) { },
    getName(_constructor: CustomElementConstructor): string | null {
        throw new Error("Function not implemented.");
    },
    whenDefined(_name: string): Promise<CustomElementConstructor> {
        throw new Error("Function not implemented.");
    },
};

// A factory function to create a custom event dispatcher.
function createCustomEventDispatcher() {
    return class {
        eventDetail: any;

        constructor(_eventType: string, initCustomEvent: CustomEventInit = {}) {
            this.eventDetail = initCustomEvent?.detail;
        }

        get detail(): any {
            return this.eventDetail;
        }
    } as unknown as typeof CustomEvent;
}

// Function to create an element.
function createElement(
    _tagName: string,
    _options?: ElementCreationOptions
): DefaultEventHandler {
    return new (createHTMLElement())();
}

// A function to create the custom global environment.
function createCustomGlobal(): typeof globalThis {
    const CustomDocumentFragment = createDocumentFragment();

    return {
        document: {
            createElement,
        },
        DocumentFragment: CustomDocumentFragment,
        customElements: customElementsRegistry,
        CustomEvent: createCustomEventDispatcher(),
        EventHandler: DefaultEventHandler,
        HTMLElement: createHTMLElement(),
    } as unknown as typeof globalThis;
}

// Check if we need to use the custom global environment.
const isCustomGlobal = typeof window === "undefined" || typeof globalThis.customElements === "undefined";
const customGlobal = isCustomGlobal ? createCustomGlobal() : globalThis;

// Export the relevant objects.
const browserObject = customGlobal as typeof globalThis;
const documentInstance: Document | any = (isCustomGlobal ? customGlobal.document : globalThis.document) as Document;
const CustomEvent = customGlobal.CustomEvent;


// Finds and returns the "fp-upload" element, facilitating the custom component's upload handling.
function setupFpUploader(componentEl: HTMLElement, uploaderId: string = "fp-upload"): any {
    const uploaderAttribute = componentEl.getAttribute(uploaderId);
    const closest = componentEl.closest(`${uploaderId}`);

    if (!componentEl) {
        return null;
    }

    if (uploaderAttribute) {
        return document.getElementById(uploaderAttribute) as HTMLElement | null;
    }

    if (closest) {
        return closest as HTMLElement | null;
    }

    const parent = (componentEl.getRootNode() as ShadowRoot).host;
    return parent ? setupFpUploader(parent as HTMLElement, uploaderId) : null;
}

export {CustomEvent, VideoUploaderElement, ResumableUpload, setupFpUploader, browserObject, documentInstance}
