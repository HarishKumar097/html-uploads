import { Uploader } from "./upChunk";
import { browserObject, CustomEvent, ResumableUpload, setupFpUploader } from "./customElements";
import "./uploadsFileSelect"
import "./uploadsDragDrop"
import "./uploadsMonitor"
import "./uploadsStatus"
import "./uploadsRetry"

class FpUploadComponent extends browserObject.HTMLElement {
    fileInput!: HTMLInputElement | null;
    mediaSelector!: HTMLElement | null;
    dropOverlayEl!: HTMLElement | null;
    resumableUpload: ResumableUpload | undefined;
    videoUploaderEl!: HTMLElement | null;
    dropHeadingEl!: HTMLElement | null;
    separatorHeadingEl!: HTMLElement | null;
    headingSpan!: HTMLSpanElement | null;
    separatorSpan!: HTMLSpanElement | null;
    overlayLabelEl!: HTMLElement | null;
    videoFile: File | undefined;

    static get observedAttributes(): string[] {
        return [
            "overlay-text",
            "disable-drop",
            "disable-monitor",
            "disable-status",
            "disable-retry",
            "chunk-size",
            "max-file-size",
            "className",
            "init-upload-url",
            "complete-upload-url",
            "retry-chunk-attempt",
            "delay-retry",
            "endpoint",
        ];
    }

    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: "open" });
        this.initTemplate(shadowRoot);
        this.initElements(shadowRoot);
    }

    connectedCallback() {
        this.initializeComponent();

        if (this.getAttribute("endpoint") && this.videoFile) {
            this.uploadFile(this.videoFile);
        }

        if (this.mediaSelector) {
            this.mediaSelector.addEventListener("click", this.handleFilePickerElClick.bind(this));
        }
    }

    attributeChangedCallback(_name: string, _oldValue: any, _newValue: any) {
        this.updateComponent();
    }

    initTemplate(shadowRoot: ShadowRoot | null) {
        const disableDrop = this.hasAttribute("disable-drop");
        shadowRoot!.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          border-radius: var(--upload-border-radius, 0.25rem);
        }
        ${disableDrop ? "div.upload-drop" : "fp-upload-drop"} {
          flex-grow: 1;
        }
        #file-select-button-default {
          cursor: pointer;
          line-height: 16px;
          background: #010023;
          color: #FFFFFF;
          border: 0px;
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
        :host([disable-monitor]) fp-upload-monitor {
          display: none;
        }
        :host([disable-retry]) fp-upload-retry {
          display: none;
        }
        :host([disable-status]) fp-upload-status {
          display: none;
        }
      </style>
      ${disableDrop ? '<div class="upload-drop">' : "<fp-upload-drop>"}
        <input id="file-input" type="file">
        <slot name="upload-file-button">
          <button id="file-select-button-default" type="button" part="upload-file-button">Upload a video</button>
        </slot>
        <fp-upload-status id="upload-status"></fp-upload-status>
        <fp-upload-retry id="upload-retry"></fp-upload-retry>
        <fp-upload-monitor progress-type="progress-status" id="upload-monitor"></fp-upload-monitor>
        <fp-upload-monitor progress-type="progress-bar" id="upload-monitor"></fp-upload-monitor>
      ${disableDrop ? "</div>" : "</fp-upload-drop>"}
    `;
    }

    initElements(shadowRoot: ShadowRoot | any) {
        this.fileInput = shadowRoot.getElementById(
            "file-input"
        ) as HTMLInputElement;
        this.mediaSelector =
            (shadowRoot
                .querySelector('slot[name="upload-file-button"]')
                .assignedElements()[0] as HTMLElement) ||
            shadowRoot.getElementById("file-select-button-default");
        this.videoUploaderEl = null;
        this.resumableUpload = undefined;
        this.handleFilePickerElClick = this.handleFilePickerElClick.bind(this);
        this.fileInput = shadowRoot.getElementById("file-input");

        if (this.fileInput) {
            this.fileInput.addEventListener("change", (event: Event) => {
                const target = event.target as HTMLInputElement;
                const files: FileList | any = target?.files;
                if (files.length > 0) {
                    this.uploadFile(files[0]);
                }
            });
        }

        this.shadowRoot
            ?.querySelector("slot")
            ?.addEventListener("slotchange", (e: { currentTarget: any }) => {
                const slot = e.currentTarget;
                const newFilePickerEl = slot
                    .assignedElements({ flatten: true })
                    .filter(
                        (el: { nodeName: any }) => !["STYLE"].includes(el.nodeName)
                    )[0];

                if (newFilePickerEl && newFilePickerEl !== this.mediaSelector) {
                    if (this.mediaSelector) {
                        this.mediaSelector.removeEventListener(
                            "click",
                            this.handleFilePickerElClick
                        );
                    }
                    this.mediaSelector = newFilePickerEl;
                    if (this.mediaSelector) {
                        this.mediaSelector.addEventListener(
                            "click",
                            this.handleFilePickerElClick.bind(this)
                        );
                    }
                }
            });

        if (
            this.mediaSelector &&
            !shadowRoot
                .querySelector('slot[name="upload-file-button"]')
                .assignedElements()[0]
        ) {
            this.mediaSelector.addEventListener(
                "click",
                this.handleFilePickerElClick.bind(this)
            );
        }
    }

    initializeComponent() {
        this.videoUploaderEl = setupFpUploader(this);
        if (this.videoUploaderEl) {
            this.videoUploaderEl.addEventListener("fileReady", () =>
                this.setFileReadyState(true)
            );
            this.videoUploaderEl.addEventListener("uploadStart", () =>
                this.setFileReadyState(true)
            );
            this.videoUploaderEl.addEventListener("reset", () => {
                this.setFileReadyState(false);
            });
            this.videoUploaderEl.addEventListener("uploadError", () =>
                this.toggleRetryUpload(true)
            );
            this.videoUploaderEl.addEventListener("progress", () =>
                this.toggleRetryUpload(false)
            );
            this.videoUploaderEl.addEventListener("success", () =>
                this.toggleRetryUpload(false)
            );
        }
    }

    handleFilePickerElClick() {
        if (this.fileInput) {
            this.fileInput.click();
        }
    }

    updateComponent() {
        const shadowRoot: ShadowRoot | null = this.shadowRoot;
        this.initTemplate(shadowRoot);
        this.initElements(shadowRoot);
        this.initializeComponent();
    }

    emitEvent(eventName: string, detail?: CustomEventInit<any>) {
        this.dispatchEvent(new CustomEvent(eventName, detail));
    }

    abort() {
        if (this.resumableUpload) {
            this.resumableUpload.abort();
        }
    }

    pause() {
        if (this.resumableUpload) {
            this.resumableUpload.pause();
        }
    }

    retryUpload() {
        if (this.resumableUpload) {
            this.resumableUpload.retryUpload();
        }
    }

    resume() {
        if (this.resumableUpload) {
            this.resumableUpload.resume();
        }
    }

    toggleRetryUpload(retry: boolean) {
        const uploadRetry = this.shadowRoot!.getElementById(
            "upload-retry"
        ) as HTMLElement;

        if (uploadRetry) {
            uploadRetry.style.marginTop = retry ? "10px" : "0px";
            uploadRetry.style.marginBottom = retry ? "10px" : "0px";
        }
    }

    setFileReadyState(isReady: boolean) {
        if (isReady) {
            this.hideUploadButtons();
        } else {
            this.resetFileInput();
            this.showUploadButtons();
            this.retryUpload();
        }
    }

    setOverlayActiveState(isActive: boolean) {
        if (this.dropOverlayEl) {
            this.dropOverlayEl.style.display = isActive ? "flex" : "none";
        }
    }

    hideUploadButtons() {
        if (this.mediaSelector) {
            this.mediaSelector.style.display = "none";
        }
    }

    showUploadButtons() {
        if (this.mediaSelector) {
            this.mediaSelector.style.display = "block";
        }
    }

    resetFileInput() {
        if (this.fileInput) {
            this.fileInput.value = "";
        }
    }

    uploadFile(file: File) {
        this.emitEvent("fileReady");

        if (file) {
            this.hideUploadButtons();
            this.videoFile = file;
        }
        const endpoint = this.getAttribute("endpoint");
        const chunkSize = this.getAttribute("chunk-size");
        const maxFileSize = this.getAttribute("max-file-size");
        const dynamicChunkSize = this.hasAttribute("dynamic-chunk-size");
        const initUploadUrl = this.getAttribute("init-upload-url");
        const completeUploadUrl = this.getAttribute("complete-upload-url");
        const retryChunkAttempt = this.getAttribute("retry-chunk-attempt");
        const delayRetry = this.getAttribute("delay-retry");

        if (!endpoint) {
            this.emitEvent("uploadError", {
                detail: {
                    message: `Unable to proceed without a specified URL or endpoint for handling the upload`,
                },
            });
            return;
        }

        try {
            this.emitEvent("uploadStart", { detail: file });

            if (endpoint && file) {
                this.resumableUpload = Uploader.init({
                    endpoint,
                    file,
                    chunkSize: parseInt(chunkSize!),
                    maxFileSize: parseInt(maxFileSize!),
                });
            }
            this.bindUploadEvents();
        } catch (error) {
            if (error instanceof Error) {
                const errorMessage = { detail: { message: error.message } };
                this.emitEvent("uploadError", errorMessage);
            }
        }
    }

    bindUploadEvents() {
        this.resumableUpload!.on("chunkAttempt", (event: Event) => {
            this.emitEvent("chunkAttempt", event);
        });
        this.resumableUpload!.on("chunkSuccess", (event: Event) => {
            this.emitEvent("chunkSuccess", event);
        });
        this.resumableUpload!.on("progress", (event: { detail: number }) => {
            this.emitEvent("progress", { detail: event.detail });
        });
        this.resumableUpload!.on("success", (success: Event) => {
            this.emitEvent("success", success);
            this.retryUpload();
        });
        this.resumableUpload!.on("online", (event: Event) => {
            this.emitEvent("online", event);
        });
        this.resumableUpload!.on("offline", (event: Event) => {
            this.emitEvent("offline", event);
        });
        this.resumableUpload!.on("error", (event: Event) => {
            console.log("errorEvent:", event)
            this.emitEvent("uploadError", event);
        });
        this.resumableUpload!.on("attemptFailure", (event: Event) => {
            this.emitEvent("chunkAttemptFailure", event);
        });
    }
}

if (!browserObject.customElements.get("fp-upload")) {
    browserObject.customElements.define("fp-upload", FpUploadComponent);
}
