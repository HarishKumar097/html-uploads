import { documentInstance, browserObject, setupFpUploader } from "./customElements";

// Define a template for the upload progress component with styling
const uploadMonitorComponent: HTMLTemplateElement = documentInstance.createElement("template");

uploadMonitorComponent.innerHTML = `
    <style>
      :host {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
      }

      .progressBarContainer {
        display: none;
        background: var(--uploader-progress-bar-backgroundcolor,#eee);
        border-radius: 100px;
        height: var(--uploader-progress-bar-height, 8px);
        width: 100%;
      }

      .monitorProgressBar{
        display: none;
        border-radius: 100px;
        background: var(--uploader-progress-fill-color,#010023);
        height: var(--uploader-progress-bar-height, 8px);
        transition: width 0.30s;
      }

      #progressStatus {
        display: none;
        font-size: inherit;
        margin: 0 0 14px;
      }
    </style>

    <p id="progressStatus"></p>
    <div class="progressBarContainer" id="progressBarContainer">
      <div role="progressbar" aria-valuemin="0" aria-valuemax="100" class="monitorProgressBar" id="monitorProgressBar" tabindex="0"></div>
    </div>
`;

// Class for handling upload monitor UI
class FpMonitorComponent extends browserObject.HTMLElement {
    videoUploaderEl: HTMLElement | null | undefined;
    progressBar: HTMLElement | null | undefined;
    uploadPercentage: HTMLElement | null | undefined;
    barTypeContainer: HTMLElement | null | undefined;
    uploadInProgress: boolean;
    progressTypeAttribute: string | null;
    displayProgressBar: boolean;

    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: "open" });
        shadowRoot.appendChild(uploadMonitorComponent.content.cloneNode(true));
        
        // Initialize elements from the shadow DOM
        this.progressBar = this.shadowRoot?.getElementById("monitorProgressBar");
        this.uploadPercentage = this.shadowRoot?.getElementById("progressStatus");
        this.barTypeContainer = this.shadowRoot?.getElementById(
            "progressBarContainer"
        );

        this.uploadInProgress = false;
        if (this.progressBar) {
            this.progressBar.style.width = "0%";
        }
    }

    connectedCallback() {
        this.videoUploaderEl = setupFpUploader(this); // Setup video uploader component
        this.progressTypeAttribute = this.getAttribute("progress-type");
        this.displayProgressBar = this.hasAttribute("file-progress-update");
        
        // Display the correct progress elements based on attributes
        if (this.displayProgressBar) {
            if (
                this.progressBar &&
                this.barTypeContainer &&
                this.progressTypeAttribute === "progress-bar"
            ) {
                this.progressBar.style.display = "block";
                this.barTypeContainer.style.display = "block";
            } else if (
                this.progressBar &&
                this.barTypeContainer &&
                this.progressTypeAttribute === "progress-status"
            ) {
                if (this.uploadPercentage) {
                    this.uploadPercentage.style.display = "block";
                    this.uploadPercentage.innerHTML = "0%";
                }
            }
        }
        
        // Event listeners for upload lifecycle events
        if (this.videoUploaderEl) {
            this.videoUploaderEl.addEventListener(
                "uploadStart",
                this.handleUploadStart
            );
            this.videoUploaderEl.addEventListener("reset", this.handleUploadReset);
            this.videoUploaderEl.addEventListener(
                "progress",
                this.handleProgressEvent
            );
            this.videoUploaderEl.addEventListener("success", this.handleSuccess);
        }
    }

    handleUploadStart = () => {
        this.progressBar?.focus();
        this.showProgressElements();
    };

    handleProgressEvent = (e: Event) => {
        // @ts-ignore
        const percent = e.detail.progress;
        this.progressBar?.setAttribute("aria-valuenow", `${Math.floor(percent)}`);

        if (this.progressBar) {
            this.progressBar.style.width = `${percent}%`;
        }

        if (this.uploadPercentage) {
            this.uploadPercentage.innerHTML = `${Math.floor(percent)}%`;
        }
    };

    handleSuccess = () => {
        this.uploadInProgress = false;
        this.hideProgressElements();
    };

    handleUploadReset = () => {
        this.uploadInProgress = false;

        if (this.uploadPercentage) {
            this.uploadPercentage.innerHTML = "";
        }

        if (this.progressBar) {
            this.progressBar.style.width = "0%";
        }
        this.hideProgressElements();
    };
    
    // Show the progress elements based on the selected type (progress bar or status)
    showProgressElements() {
        if (this.progressBar && this.uploadPercentage && this.barTypeContainer) {
            if (
                this.progressTypeAttribute === "progress-bar" ||
                this.progressTypeAttribute === null
            ) {
                this.progressBar.style.display = "block";
                this.barTypeContainer.style.display = "block";
            } else if (this.progressTypeAttribute === "progress-status") {
                this.uploadPercentage.style.display = "block";
            }
        }
    }
    
    // Hide the progress elements when upload is not in progress
    hideProgressElements() {
        if (this.progressBar && this.uploadPercentage && this.barTypeContainer) {
            if (!this.displayProgressBar) {
                this.progressBar.style.display = "none";
                this.barTypeContainer.style.display = "none";
            }
            if (!this.displayProgressBar) {
                this.uploadPercentage.style.display = "none";
            }
        }
    }
}

if (!browserObject.customElements.get("fp-upload-monitor")) {
    browserObject.customElements.define("fp-upload-monitor", FpMonitorComponent);
}
