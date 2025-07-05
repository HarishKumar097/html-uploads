import { browserObject, documentInstance, setupFpUploader } from "./customElements";

// Define a template for the upload lifecycle status text
const uploadStatusComponent: HTMLTemplateElement = documentInstance.createElement("template");

uploadStatusComponent.innerHTML = `
    <style>
      :host {
        display: block;
      }

      #status-element {
        display: none;
      }
    </style>

    <span id="status-element" role="status" aria-live="polite"></span>
`;

class FpStatusComponent extends browserObject.HTMLElement {
    statusElement: HTMLElement | null | undefined;
    uploaderStatusEl: HTMLElement | null | undefined;

    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: "open" });
        shadowRoot.appendChild(uploadStatusComponent.content.cloneNode(true));
        
        // Get the status element inside the shadow DOM.
        this.statusElement = this.shadowRoot?.getElementById("status-element");
    }

    connectedCallback() {
        this.uploaderStatusEl = setupFpUploader(this);  // Set up the uploader element
        
         // Set up event listeners for the uploader component, if it exists
        if (this.uploaderStatusEl) {
            this.uploaderStatusEl.addEventListener("reset", this.clearStatusElement);
            this.uploaderStatusEl.addEventListener(
                "uploadError",
                this.handleUploadError
            );
            this.uploaderStatusEl.addEventListener(
                "success",
                this.handleUploadSuccess
            );
            this.uploaderStatusEl.addEventListener(
                "uploadStart",
                this.clearStatusElement
            );
            this.uploaderStatusEl.addEventListener(
                "progress",
                this.clearStatusElement
            );
            this.uploaderStatusEl.addEventListener("offline", this.handleUploadError);
        }
    }
    
    // Clears the status message and hides the status element.
    clearStatusElement = () => {
        if (this.statusElement) {
            this.statusElement.style.display = "none";
            this.statusElement.innerHTML = "";
        }
    };
    
    // Handles when an upload fails.
    handleUploadError = (event: any) => {
        if (this.statusElement) {
            this.statusElement.style.display = "block";
            const customFailureMessage = this.getAttribute("failure-message");
            this.statusElement.innerHTML = customFailureMessage
                ? customFailureMessage
                : event.detail.message;
        }
    };
    
    // Handles when an upload is successful.
    handleUploadSuccess = () => {
        const customStatusMessage = this.getAttribute("success-message");
        const successMessage = customStatusMessage
            ? customStatusMessage
            : "Upload completed successfully!";

        if (this.statusElement) {
            this.statusElement.style.display = "block";
            this.statusElement.innerHTML = successMessage;
        }
    };
}

if (!browserObject.customElements.get("fp-upload-status")) {
    browserObject.customElements.define("fp-upload-status", FpStatusComponent);
}