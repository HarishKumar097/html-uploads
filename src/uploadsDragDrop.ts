import { documentInstance, browserObject, VideoUploaderElement, setupFpUploader } from "./customElements";

// Define a template for the drag-and-drop upload component with styling and default slots.
const uploadDropComponent: HTMLTemplateElement = documentInstance.createElement("template");

uploadDropComponent.innerHTML = `
    <style>
      :host {
        position: relative;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border: var(--upload-border-width, 2px) var(--upload-border-style, dashed) var(--upload-border-color, #ccc);
        padding: 2.5rem 2rem;
        border-radius: var(--upload-border-radius, 0.25rem);
      }

      #headingSpan {
        margin-bottom: 12px; 
        font-size: 28px;
      }

      #separatorSpan {
        margin-bottom: 12px;
      }

      ::slotted([slot="heading"]) {
        font-size: 28px;
        margin-bottom: 12px;
      }

      ::slotted([slot="separator"]) {
         margin-bottom: 12px;
      }

      #overlayContainer {
        display: none;
        position: absolute;
        top: 0;
        bottom: 0;
        right: 0;
        left: 0;
        height: 100%;
        width: 100%;
        background: var(--uploader-overlay-background-color, #dbd15a);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        color: var(--overlay-text-color, #000);
        font-size: var(--overlay-text-font-size, 20px);
        border-radius: var(--upload-border-radius, 0.25rem);
      }

      #overlayHeader {
        color: inherit;
        font-size: inherit;
      }
    </style>

    <slot name="heading" part="heading">
      <span id="headingSpan">Drop a video file here to upload</span>
    </slot>
    <slot name="separator" part="separator">
      <span id="separatorSpan">or</span>
    </slot>
    <slot></slot>
    <div id="overlayContainer">
      <h2 id="overlayHeader"></h2>
    </div>
`;

// Define the custom drag-and-drop component class.
class FpDragComponent extends browserObject.HTMLElement {
    videoUploaderEl: VideoUploaderElement | null | undefined;
    dropHeadingEl: HTMLElement | null;
    seperatorHeadingEl: HTMLElement | null;
    dropOverlayEl: HTMLElement | null;
    overlayLabelEl: HTMLElement | null;
    headingSpan: HTMLElement | null;
    separatorSpan: HTMLElement | null;
    uploadInProgress: boolean = false;

    static get observedAttributes() {
        return ["overlay-text"];
    }

    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: "open" });
        shadowRoot.appendChild(uploadDropComponent.content.cloneNode(true));

        // Initialize references to key elements within the shadow DOM
        this.dropHeadingEl = shadowRoot.querySelector('slot[name="heading"]');
        this.seperatorHeadingEl = shadowRoot.querySelector(
            'slot[name="separator"]'
        );
        this.dropOverlayEl = shadowRoot.getElementById("overlayContainer");
        this.overlayLabelEl = shadowRoot.getElementById("overlayHeader");
        this.headingSpan = shadowRoot.getElementById("headingSpan");
        this.separatorSpan = shadowRoot.getElementById("separatorSpan");
        this.uploadInProgress = false;
        if (this.dropOverlayEl) {
            this.dropOverlayEl.style.display = "none";
        }
    }

    connectedCallback() {
        this.videoUploaderEl = setupFpUploader(this); // Initialize uploader element

        // Set up event listeners for the uploader component, if it exists
        if (this.videoUploaderEl) {
            this.videoUploaderEl.addEventListener("fileReady", () =>
                this.setFileReadyState(true)
            );
            this.videoUploaderEl.addEventListener("uploadStart", () => {
                this.setFileReadyState(true);
                this.uploadInProgress = true;
            });
            this.videoUploaderEl.addEventListener("reset", () => {
                this.setFileReadyState(false);
                this.uploadInProgress = false;
            });

            this.getDroppedFile();
        }

        this.updateOverlayText();
    }

    attributeChangedCallback(name: string, _oldValue: string, _newValue: string) {
        if (name === "overlay-text") {
            this.updateOverlayText();
        }
    }

    getDroppedFile() {
        this.addEventListener(
            "dragenter",
            (evt: {
                target: any;
                preventDefault: () => void;
                stopPropagation: () => void;
            }) => {
                evt.preventDefault();
                evt.stopPropagation();

                if (!this.uploadInProgress) {
                    this.setOverlayActiveState(true);
                }
            }
        );

        this.addEventListener(
            "dragleave",
            (evt: { preventDefault: () => void; stopPropagation: () => void }) => {
                evt.preventDefault();
                evt.stopPropagation();
                this.setOverlayActiveState(false);
            }
        );

        this.addEventListener(
            "dragover",
            (evt: { preventDefault: () => void; stopPropagation: () => void }) => {
                evt.preventDefault();
                evt.stopPropagation();
            }
        );

        this.addEventListener(
            "drop",
            (evt: {
                preventDefault?: any;
                stopPropagation?: any;
                dataTransfer?: any;
            }) => {
                evt.preventDefault();
                evt.stopPropagation();
                const file = evt?.dataTransfer?.files[0];

                if (this.videoUploaderEl && !this.uploadInProgress) {
                    (this.videoUploaderEl).uploadFile(file);
                }
                this.setOverlayActiveState(false);
            }
        );
    }

    setFileReadyState(isReady: boolean) {
        if (isReady) {
            (this.dropHeadingEl as HTMLElement).style.display = "none";
            (this.seperatorHeadingEl as HTMLElement).style.display = "none";
            (this.headingSpan as HTMLElement).style.display = "none";
            (this.separatorSpan as HTMLElement).style.display = "none";
        } else {
            if (this.dropHeadingEl) {
                (this.dropHeadingEl as HTMLElement).style.display = "block";
                (this.dropHeadingEl as HTMLElement).style.marginBottom = "12px";
            }

            if (this.seperatorHeadingEl) {
                (this.seperatorHeadingEl as HTMLElement).style.display = "block";
                (this.seperatorHeadingEl as HTMLElement).style.marginBottom = "12px";
            }

            if (this.headingSpan) {
                this.headingSpan.style.display = "block";
                this.headingSpan.style.marginBottom = "12px";
            }

            if (this.separatorSpan) {
                this.separatorSpan.style.display = "block";
                this.separatorSpan.style.marginBottom = "12px";
            }
        }
    }

    setOverlayActiveState(isActive: boolean) {
        if (isActive) {
            (this.dropOverlayEl as HTMLElement).style.display = "flex";
        } else {
            (this.dropOverlayEl as HTMLElement).style.display = "none";
        }
    }

    updateOverlayText() {
        if (this.overlayLabelEl && !this.uploadInProgress) {
            const overlayText = this.getAttribute("overlay-text") || "";
            this.overlayLabelEl.textContent = overlayText;
        }
    }
}

if (!browserObject.customElements.get("fp-upload-drop")) {
    browserObject.customElements.define("fp-upload-drop", FpDragComponent);
}
