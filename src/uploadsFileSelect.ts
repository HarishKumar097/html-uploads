import { documentInstance, browserObject, VideoUploaderElement, setupFpUploader } from "./customElements";

const uploadButtonComponent: HTMLTemplateElement = documentInstance.createElement("template");

uploadButtonComponent.innerHTML = `
    <style>
      #file-select-button-default {
        cursor: pointer;
        line-height: 16px;
        background: #010023;
        color: #FFFFFF;
        border:0px;
        padding: 16px 24px;
        border-radius: 4px;
        transition: all 0.2s ease;
        font-family: inherit;
        font-size: inherit;
        position: relative;
      }

      #file-select-button-default:active {
        background: #eee;
        color: #010023;
      }

      input[type="file"] {
        display: none;
      }
    </style>

    <slot name="upload-file-button">
      <button id="file-select-button-default" type="button" part="upload-file-button">Upload a video</button>
    </slot>
    <input id="file-input" type="file">
`;

class FpFileSelectComponent extends browserObject.HTMLElement {
    mediaSelector: HTMLButtonElement | null = null;
    inputFile: HTMLInputElement | null = null;
    videoUploaderEl: VideoUploaderElement | null = null;


    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: "open" });
        shadowRoot.appendChild(uploadButtonComponent.content.cloneNode(true));

        // Bind the click handler to maintain the context of `this`
        this.handleFilePickerElClick = this.handleFilePickerElClick.bind(this);

        // Initialize slotted media selector button and input file element
        this.mediaSelector = this.shadowRoot?.querySelector("button") as HTMLButtonElement | null;
        this.inputFile = shadowRoot.getElementById("file-input") as HTMLInputElement;

        // Add event listener to file input element for file selection
        this.inputFile?.addEventListener("change", (event: Event) => {
            const files = (event.target as HTMLInputElement).files;
            if (files && files.length > 0) {
                if (this.videoUploaderEl) {
                    this.videoUploaderEl.uploadFile(files[0]);
                }
            }
        });

        this.shadowRoot
            ?.querySelector("slot")
            ?.addEventListener("slotchange", (e: Event) => {
                const slot = e.currentTarget as HTMLSlotElement;
                this.mediaSelector = slot
                    .assignedElements({ flatten: true })
                    .filter(
                        (el: { nodeName: any }) => !["STYLE"].includes(el.nodeName)
                    )[0] as HTMLButtonElement | null;

                if (this.mediaSelector) {
                    this.handleFileUpload();
                }
            });
    }

    connectedCallback() {

         // Initialize the videoUploaderEl with a reference to the closest uploader component
        this.videoUploaderEl = setupFpUploader(this);

        if (this.mediaSelector) {
            this.handleFileUpload();
        }
        
        // Set up event listeners on the videoUploaderEl if it exists
        if (this.videoUploaderEl) {
            this.videoUploaderEl.addEventListener("fileReady", () => {
                if (this.mediaSelector) {
                    this.mediaSelector.style.display = "none";
                }
            });

            this.videoUploaderEl.addEventListener("reset", () => {
                if (this.mediaSelector) {
                    this.mediaSelector.style.display = "block";
                }

                if (this.inputFile) {
                    this.inputFile.value = "";
                }
            });

            if (this.mediaSelector) {
                this.mediaSelector.addEventListener(
                    "click",
                    this.handleFilePickerElClick
                );
            }
        }
    }
    
    // Sets up the event handler for clicking the upload button to open file selection
    handleFileUpload() {
        if (this.mediaSelector) {
            this.mediaSelector.addEventListener(
                "click",
                this.handleFilePickerElClick
            );
        }
    } 

    // Opens the file input dialog when the upload button is clicked
    handleFilePickerElClick() {
        if (this.inputFile) {
            this.inputFile.click();
        }
    }
}

if (!browserObject.customElements.get("fp-upload-file-select")) {
    browserObject.customElements.define(
        "fp-upload-file-select",
        FpFileSelectComponent
    );
}