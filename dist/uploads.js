"use strict";
(() => {
  // src/upChunk.ts
  var defaultChunkSize = 16384;
  function calculateChunkSize(options) {
    const chunkSize = options.chunkSize ? Number(options.chunkSize) : defaultChunkSize;
    return chunkSize * 1024;
  }
  var VideoChunkProcessor = class {
    constructor(file) {
      this.file = file;
      this.fileSize = file == null ? void 0 : file.size;
    }
    async getChunk(chunkStart, chunkEnd) {
      if (chunkEnd > this.fileSize) {
        chunkEnd = this.fileSize;
      }
      try {
        const blob = this.file.slice(chunkStart, chunkEnd);
        const stream = blob.stream();
        const chunks = [];
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        return new Blob(chunks, { type: this.file.type });
      } catch (error) {
        return this.file.slice(chunkStart, chunkEnd);
      }
    }
  };
  var Uploader = class _Uploader {
    constructor(props) {
      this.maxConsecutiveBackoffFailures = 5;
      this.consecutiveBackoffFailures = 0;
      this.chunkUploadFailureHandler = async (res) => {
        const isRetryable = [408, 429, 500, 502, 503, 504].includes(res.statusCode);
        const hasRetriesLeft = this.retryCount < this.maxRetryAttempts;
        const shouldUploadContinue = this.canProceedWithUpload();
        let shouldRetry = false;
        if (!shouldUploadContinue) {
          shouldRetry = false;
        } else if (isRetryable && hasRetriesLeft) {
          await this.handleRetryChunkUploading(res);
          shouldRetry = true;
        } else if (!isRetryable && res.statusCode > 0) {
          this.emitEvent("error", {
            ...this.getCommonEventData(),
            message: `Upload failed with server response code ${res.statusCode}. Please check your connection and try again.`,
            chunk: this.currentChunkIndex,
            response: res,
            statusCode: res.statusCode
          });
          shouldRetry = false;
        } else if (res.statusCode <= 0 && hasRetriesLeft) {
          await this.handleRetryChunkUploading(res);
          shouldRetry = true;
        } else {
          this.emitEvent("error", {
            ...this.getCommonEventData(),
            message: `Upload stopped after ${this.retryCount} failed attempts. The server responded with error code ${res.statusCode}. Please try again later.`,
            chunk: this.currentChunkIndex,
            response: res,
            failedAttempts: this.retryCount,
            maxAttempts: this.maxRetryAttempts,
            statusCode: res.statusCode
          });
          shouldRetry = false;
        }
        return shouldRetry;
      };
      this.uploadEndpoint = props.endpoint;
      this.sourceFile = props.file;
      this.maxRetryAttempts = Number(props.retryChunkAttempt) || 5;
      this.retryDelaySeconds = Number(props.delayRetry) || 1;
      this.configuredChunkSize = Number(props.chunkSize);
      this.maxFileSizeBytes = (Number(props.maxFileSize) || 0) * 1024;
      this.validateUserInput();
      this.currentChunkIndex = 0;
      this.retryCount = 0;
      this.isNetworkOffline = false;
      this.isUploadPaused = false;
      this.isUploadAborted = false;
      this.isUploadProgress = false;
      this.retryTimeoutId = void 0;
      this.currentChunkStartPosition = 0;
      this.successfulChunksCount = 0;
      this.currentChunkBytes = 0;
      this.lastChunkTimestamp = 0;
      this.consecutiveBackoffFailures = 0;
      this.uploadStartTimestamp = Date.now();
      this.configuredChunkBytes = calculateChunkSize(props);
      this.eventEmitter = new EventTarget();
      this.totalChunksCount = Math.ceil(
        this.sourceFile.size / this.configuredChunkBytes
      );
      if (props == null ? void 0 : props.file) {
        this.chunkProcessor = new VideoChunkProcessor(props == null ? void 0 : props.file);
      }
      this.requestChunk();
      if (typeof window !== "undefined") {
        window.addEventListener("online", () => {
          if (!this.sessionUri && this.uploadEndpoint && this.isNetworkOffline) {
            this.initiateSession();
            this.isNetworkOffline = false;
          } else if (this.isNetworkOffline && !this.isUploadAborted && this.retryCount < this.maxRetryAttempts && this.totalChunksCount > 0) {
            this.isNetworkOffline = false;
            if (this.totalChunksCount !== this.successfulChunksCount) {
              this.emitEvent("online", {
                ...this.getCommonEventData(),
                message: "Connection restored. Resuming your upload."
              });
              if (!this.isUploadPaused) {
                clearTimeout(this.retryTimeoutId);
                this.validateUploadStatus();
              }
            }
          }
        });
        window.addEventListener("offline", () => {
          this.isNetworkOffline = true;
          if (this.totalChunksCount !== this.successfulChunksCount && this.canRetryUpload() && this.totalChunksCount > 0) {
            this.abortActiveXhr();
            this.emitEvent("offline", {
              ...this.getCommonEventData(),
              message: "Connection lost. Your upload has been paused. It will automatically resume when the connection is restored."
            });
          }
        });
      }
    }
    static init(uploadProps) {
      return new _Uploader(uploadProps);
    }
    async initiateSession() {
      var _a, _b, _c;
      try {
        const response = await fetch(this.uploadEndpoint, {
          method: "POST",
          headers: {
            "x-goog-resumable": "start",
            "Content-Type": (_b = (_a = this.sourceFile) == null ? void 0 : _a.type) != null ? _b : "application/octet-stream",
            "Origin": "*"
          }
        });
        if (!response.ok) {
          const errorText = await response.text();
          this.emitEvent("error", {
            message: `Failed to initiate resumable upload session: ${response.status} ${response.statusText || errorText}`
          });
          return;
        }
        const locationHeader = response.headers.get("Location");
        if (!locationHeader) {
          this.emitEvent("error", {
            message: "No session URI returned from GCS. Please check bucket CORS settings or signed URL generation."
          });
          return;
        }
        this.sessionUri = locationHeader;
        this.validateUploadStatus();
      } catch (err) {
        const error = err;
        this.emitEvent("error", {
          message: "Network error while initiating upload session",
          detail: (_c = error.message) != null ? _c : ""
        });
      }
    }
    abortActiveXhr() {
      if (this.activeRequest) {
        this.activeRequest.abort();
        this.activeRequest = void 0;
      }
    }
    // Method to abort the current chunk being uploaded
    abort() {
      if (this.totalChunksCount > 0 && this.activeRequest) {
        this.abortActiveXhr();
        this.isUploadAborted = true;
        this.retryUpload();
        this.emitEvent("error", {
          ...this.getCommonEventData(),
          message: "Upload aborted. Please try again!"
        });
      } else {
        this.retryUpload();
      }
    }
    // Method to pause the upload process
    pause() {
      if (this.canProceedWithUpload() && this.retryCount < this.maxRetryAttempts) {
        this.isUploadPaused = true;
      }
    }
    // Method to resume the upload process
    resume() {
      if (this.canResumeUpload()) {
        this.isUploadPaused = false;
        if (this.totalChunksCount !== this.successfulChunksCount && !this.isUploadProgress) {
          this.requestChunk();
        }
      }
    }
    // Method to retry the upload process
    retryUpload() {
      this.abortActiveXhr();
      this.resetUploadState();
    }
    // Method to validate user-provided properties
    validateUserInput() {
      if (!this.uploadEndpoint || typeof this.uploadEndpoint !== "function" && typeof this.uploadEndpoint !== "string") {
        throw new TypeError(
          "Upload endpoint is required. Please provide either a URL string or a function that returns a promise."
        );
      }
      if (!(this.sourceFile instanceof File)) {
        throw new TypeError(
          "Invalid file format. Please provide a valid File object."
        );
      }
      if (this.configuredChunkSize && this.configuredChunkSize > 0) {
        if (this.configuredChunkSize % 256 !== 0) {
          throw new TypeError(
            `Chunk size must be a multiple of 256 KB. Current chunk size: ${this.configuredChunkSize} KB.`
          );
        }
        if (this.configuredChunkSize < 256) {
          throw new TypeError(
            `Chunk size must be at least 256 KB. Current chunk size: ${this.configuredChunkSize} KB.`
          );
        }
        if (this.configuredChunkSize > 512e3) {
          throw new TypeError(
            `Chunk size cannot exceed 500MB (512000 KB) to ensure reliable uploads. Current chunk size: ${this.configuredChunkSize} KB.`
          );
        }
      }
      if (this.maxFileSizeBytes > 0 && this.maxFileSizeBytes < this.sourceFile.size) {
        const fileSizeMB = (this.sourceFile.size / (1024 * 1024)).toFixed(2);
        const maxSizeMB = (this.maxFileSizeBytes / (1024 * 1024)).toFixed(2);
        throw new Error(
          `File size ${fileSizeMB}MB exceeds the maximum allowed size of ${maxSizeMB}MB. Please choose a smaller file.`
        );
      }
    }
    on(eventName, fn) {
      this.eventEmitter.addEventListener(eventName, fn);
    }
    emitEvent(eventName, detail) {
      this.eventEmitter.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
    getCommonEventData() {
      var _a, _b;
      return {
        totalChunks: this.totalChunksCount,
        uploadedChunks: this.successfulChunksCount,
        remainingChunks: this.totalChunksCount - this.successfulChunksCount,
        totalProgress: this.successfulChunksCount / this.totalChunksCount * 100,
        fileName: (_a = this.sourceFile.name) != null ? _a : "",
        fileSize: (_b = this.sourceFile.size) != null ? _b : ""
      };
    }
    canProceedWithUpload() {
      return !this.isNetworkOffline && !this.isUploadPaused && !this.isUploadAborted && this.totalChunksCount > 0;
    }
    canResumeUpload() {
      return this.isUploadPaused && !this.isNetworkOffline && !this.isUploadAborted && this.retryCount < this.maxRetryAttempts && this.totalChunksCount > 0;
    }
    canRetryUpload() {
      return !this.isUploadPaused && !this.isUploadAborted && this.retryCount < this.maxRetryAttempts;
    }
    resetUploadState() {
      this.currentChunkIndex = 0;
      this.successfulChunksCount = 0;
      this.currentChunkBytes = 0;
      this.lastChunkTimestamp = 0;
      this.consecutiveBackoffFailures = 0;
      this.totalChunksCount = 0;
      this.retryCount = 0;
      this.isNetworkOffline = false;
      this.isUploadPaused = false;
      this.isUploadAborted = true;
      this.retryTimeoutId = void 0;
      this.uploadStartTimestamp = Date.now();
    }
    calculateProgress(event) {
      var _a;
      const remainingChunks = this.totalChunksCount - this.currentChunkIndex;
      const progressChunkSize = this.sourceFile.size - this.currentChunkStartPosition;
      const progressPerChunk = progressChunkSize / this.sourceFile.size / remainingChunks;
      const successfulProgress = this.currentChunkStartPosition / this.sourceFile.size;
      const checkTotalChunkSize = (_a = event.total) != null ? _a : this.configuredChunkBytes;
      const currentChunkProgress = event.loaded / checkTotalChunkSize;
      const chunkProgress = currentChunkProgress * progressPerChunk;
      const uploadProgress = Math.min(
        (successfulProgress + chunkProgress) * 100,
        100
      );
      return uploadProgress;
    }
    parseResponseHeaders(headers) {
      const headerMap = {};
      headers.trim().split(/[\r\n]+/).forEach((line) => {
        const parts = line.split(": ");
        const header = parts.shift();
        const value = parts.join(": ");
        if (header) {
          headerMap[header.toLowerCase()] = value;
        }
      });
      return headerMap;
    }
    handleChunkSuccess(uploadResponse) {
      this.currentChunkIndex++;
      this.successfulChunksCount += 1;
      this.consecutiveBackoffFailures = 0;
      const prevChunkUploadedTime = /* @__PURE__ */ new Date();
      const prevChunkUploadedInterval = (prevChunkUploadedTime.getTime() - this.lastChunkTimestamp) / 1e3;
      this.emitEvent("chunkSuccess", {
        ...this.getCommonEventData(),
        chunk: this.currentChunkIndex,
        timeInterval: prevChunkUploadedInterval,
        response: uploadResponse
      });
      this.currentChunkStartPosition = this.currentChunkStartPosition + this.currentChunkBytes;
      this.validateUploadStatus();
    }
    handleResumeUpload(uploadedBytes, prevChunkRangeEnd, uploadResponse) {
      if (uploadedBytes < prevChunkRangeEnd) {
        this.handleRetryChunkUploading(uploadResponse);
      } else {
        this.handleChunkSuccess(uploadResponse);
      }
    }
    submitHttpRequest(options) {
      return new Promise((resolve) => {
        let xhr = new XMLHttpRequest();
        this.activeRequest = xhr;
        const sourceType = this.sourceFile.type ? this.sourceFile.type : "application/octet-stream";
        const chunkRangeStart = this.currentChunkStartPosition;
        const chunkRangeEnd = this.currentChunkStartPosition + this.currentChunkBytes - 1;
        if (this.retryTimeoutId) {
          clearTimeout(this.retryTimeoutId);
        }
        xhr.open(options.method, options.url, true);
        xhr.upload.onprogress = (event) => {
          this.isUploadProgress = true;
          const progress = this.calculateProgress(event);
          this.emitEvent("progress", {
            ...this.getCommonEventData(),
            progress
          });
        };
        xhr.onreadystatechange = () => {
          if (xhr.readyState === 4) {
            this.isUploadProgress = false;
            const headerMap = this.parseResponseHeaders(
              xhr.getAllResponseHeaders()
            );
            const uploadResponse = {
              statusCode: xhr.status,
              responseBody: xhr.response,
              url: options.url,
              method: "PUT",
              headers: headerMap
            };
            if (xhr.status === 308) {
              const rangeHeader = headerMap["range"];
              if (rangeHeader) {
                const rangeMatch = /bytes=0-(\d+)/.exec(rangeHeader);
                if (rangeMatch) {
                  const uploadedBytes = parseInt(rangeMatch[1], 10);
                  this.handleResumeUpload(
                    uploadedBytes,
                    chunkRangeEnd,
                    uploadResponse
                  );
                  resolve(uploadResponse);
                  return;
                }
              }
              this.handleChunkSuccess(uploadResponse);
              resolve(uploadResponse);
              return;
            } else if ([200, 201, 204, 206].includes(xhr.status)) {
              this.handleChunkSuccess(uploadResponse);
            } else {
              this.chunkUploadFailureHandler(uploadResponse);
            }
            resolve(uploadResponse);
          }
        };
        xhr.setRequestHeader("Content-Type", sourceType);
        xhr.setRequestHeader(
          "Content-Range",
          `bytes ${chunkRangeStart}-${chunkRangeEnd}/${this.sourceFile.size}`
        );
        xhr.send(options.body);
      });
    }
    async handleRetryChunkUploading(res) {
      if (this.canRetryUpload() && !this.isNetworkOffline && navigator.onLine) {
        const requiresBackoff = res && [408, 429, 500, 502, 503, 504].includes(res.statusCode);
        if (requiresBackoff) {
          this.consecutiveBackoffFailures++;
          if (this.consecutiveBackoffFailures >= this.maxConsecutiveBackoffFailures) {
            this.emitEvent("error", {
              ...this.getCommonEventData(),
              message: `Upload stopped after ${this.consecutiveBackoffFailures} consecutive failures. Please try again later.`,
              chunk: this.currentChunkIndex,
              response: res,
              statusCode: res.statusCode,
              failedAttempts: this.consecutiveBackoffFailures
            });
            return;
          }
        } else {
          this.consecutiveBackoffFailures = 0;
        }
        let delay;
        if (requiresBackoff) {
          const baseDelay = 2e3;
          delay = Math.min(
            baseDelay * Math.pow(2, this.retryCount) + Math.random() * 1e3,
            5e3
          );
        } else {
          delay = this.retryDelaySeconds * 1e3;
        }
        this.retryTimeoutId = setTimeout(() => {
          if (this.canRetryUpload() && !this.isNetworkOffline) {
            if (!requiresBackoff || res.statusCode === 308) {
              this.retryCount++;
            }
            this.emitEvent("chunkAttemptFailure", {
              ...this.getCommonEventData(),
              chunkAttempt: this.retryCount,
              totalChunkFailureAttempts: this.maxRetryAttempts,
              chunkNumber: this.currentChunkIndex + 1
            });
            this.requestChunk();
          }
        }, delay);
      }
    }
    // Method to validate the upload status and proceed accordingly
    async validateUploadStatus() {
      if (this.totalChunksCount === this.successfulChunksCount) {
        const totalDuration = (Date.now() - this.uploadStartTimestamp) / 1e3;
        this.emitEvent("success", {
          ...this.getCommonEventData(),
          uploadDuration: (Date.now() - this.lastChunkTimestamp) / 1e3,
          totalDuration
        });
      } else {
        this.requestChunk();
      }
    }
    // Method to initiate chunk uploads
    async requestChunk() {
      if (this.canProceedWithUpload() && navigator.onLine) {
        try {
          let currentChunk;
          if (this.chunkProcessor) {
            const chunkEnd = this.currentChunkStartPosition + this.configuredChunkBytes;
            currentChunk = await this.chunkProcessor.getChunk(
              this.currentChunkStartPosition,
              chunkEnd
            );
          }
          if (currentChunk) {
            if (currentChunk == null ? void 0 : currentChunk.size) {
              this.currentChunkBytes = currentChunk == null ? void 0 : currentChunk.size;
            }
            this.emitEvent("chunkAttempt", {
              ...this.getCommonEventData(),
              chunkNumber: this.currentChunkIndex + 1,
              chunkSize: currentChunk == null ? void 0 : currentChunk.size
            });
            this.lastChunkTimestamp = Date.now();
            this.submitHttpRequest({
              method: "PUT",
              url: this.sessionUri || this.uploadEndpoint,
              body: currentChunk
            });
          }
        } catch (error) {
          this.emitEvent("error", {
            message: "An error occurred while preparing the chunk for upload. Please try again.",
            statusCode: 0
          });
        }
      }
    }
  };
  if (typeof window !== "undefined") {
    window.Uploader = Uploader;
  }

  // src/customElements.ts
  var DefaultEventHandler = class {
    removeEventListener(_type, _listener, _options) {
    }
    addEventListener(_type, _listener, _options) {
    }
    dispatchEvent(_event) {
      return true;
    }
  };
  function createHTMLElement() {
    return class extends DefaultEventHandler {
    };
  }
  function createDocumentFragment() {
    return class extends DefaultEventHandler {
    };
  }
  var customElementsRegistry = {
    get(_name) {
      return void 0;
    },
    define(_name, _constructor, _options) {
    },
    upgrade(_root) {
    },
    getName(_constructor) {
      throw new Error("Function not implemented.");
    },
    whenDefined(_name) {
      throw new Error("Function not implemented.");
    }
  };
  function createCustomEventDispatcher() {
    return class {
      constructor(_eventType, initCustomEvent = {}) {
        this.eventDetail = initCustomEvent == null ? void 0 : initCustomEvent.detail;
      }
      get detail() {
        return this.eventDetail;
      }
    };
  }
  function createElement(_tagName, _options) {
    return new (createHTMLElement())();
  }
  function createCustomGlobal() {
    const CustomDocumentFragment = createDocumentFragment();
    return {
      document: {
        createElement
      },
      DocumentFragment: CustomDocumentFragment,
      customElements: customElementsRegistry,
      CustomEvent: createCustomEventDispatcher(),
      EventHandler: DefaultEventHandler,
      HTMLElement: createHTMLElement()
    };
  }
  var isCustomGlobal = typeof window === "undefined" || typeof globalThis.customElements === "undefined";
  var customGlobal = isCustomGlobal ? createCustomGlobal() : globalThis;
  var browserObject = customGlobal;
  var documentInstance = isCustomGlobal ? customGlobal.document : globalThis.document;
  var CustomEvent2 = customGlobal.CustomEvent;
  function setupFpUploader(componentEl, uploaderId = "fp-upload") {
    const uploaderAttribute = componentEl.getAttribute(uploaderId);
    const closest = componentEl.closest(`${uploaderId}`);
    if (!componentEl) {
      return null;
    }
    if (uploaderAttribute) {
      return document.getElementById(uploaderAttribute);
    }
    if (closest) {
      return closest;
    }
    const parent = componentEl.getRootNode().host;
    return parent ? setupFpUploader(parent, uploaderId) : null;
  }

  // src/uploadsFileSelect.ts
  var uploadButtonComponent = documentInstance.createElement("template");
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
  var FpFileSelectComponent = class extends browserObject.HTMLElement {
    constructor() {
      var _a, _b, _c, _d;
      super();
      this.mediaSelector = null;
      this.inputFile = null;
      this.videoUploaderEl = null;
      const shadowRoot = this.attachShadow({ mode: "open" });
      shadowRoot.appendChild(uploadButtonComponent.content.cloneNode(true));
      this.handleFilePickerElClick = this.handleFilePickerElClick.bind(this);
      this.mediaSelector = (_a = this.shadowRoot) == null ? void 0 : _a.querySelector("button");
      this.inputFile = shadowRoot.getElementById("file-input");
      (_b = this.inputFile) == null ? void 0 : _b.addEventListener("change", (event) => {
        const files = event.target.files;
        if (files && files.length > 0) {
          if (this.videoUploaderEl) {
            this.videoUploaderEl.uploadFile(files[0]);
          }
        }
      });
      (_d = (_c = this.shadowRoot) == null ? void 0 : _c.querySelector("slot")) == null ? void 0 : _d.addEventListener("slotchange", (e) => {
        const slot = e.currentTarget;
        this.mediaSelector = slot.assignedElements({ flatten: true }).filter(
          (el) => !["STYLE"].includes(el.nodeName)
        )[0];
        if (this.mediaSelector) {
          this.handleFileUpload();
        }
      });
    }
    connectedCallback() {
      this.videoUploaderEl = setupFpUploader(this);
      if (this.mediaSelector) {
        this.handleFileUpload();
      }
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
  };
  if (!browserObject.customElements.get("fp-upload-file-select")) {
    browserObject.customElements.define(
      "fp-upload-file-select",
      FpFileSelectComponent
    );
  }

  // src/uploadsDragDrop.ts
  var uploadDropComponent = documentInstance.createElement("template");
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
  var FpDragComponent = class extends browserObject.HTMLElement {
    constructor() {
      super();
      this.uploadInProgress = false;
      const shadowRoot = this.attachShadow({ mode: "open" });
      shadowRoot.appendChild(uploadDropComponent.content.cloneNode(true));
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
    static get observedAttributes() {
      return ["overlay-text"];
    }
    connectedCallback() {
      this.videoUploaderEl = setupFpUploader(this);
      if (this.videoUploaderEl) {
        this.videoUploaderEl.addEventListener(
          "fileReady",
          () => this.setFileReadyState(true)
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
    attributeChangedCallback(name, _oldValue, _newValue) {
      if (name === "overlay-text") {
        this.updateOverlayText();
      }
    }
    getDroppedFile() {
      this.addEventListener(
        "dragenter",
        (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          if (!this.uploadInProgress) {
            this.setOverlayActiveState(true);
          }
        }
      );
      this.addEventListener(
        "dragleave",
        (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          this.setOverlayActiveState(false);
        }
      );
      this.addEventListener(
        "dragover",
        (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
        }
      );
      this.addEventListener(
        "drop",
        (evt) => {
          var _a;
          evt.preventDefault();
          evt.stopPropagation();
          const file = (_a = evt == null ? void 0 : evt.dataTransfer) == null ? void 0 : _a.files[0];
          if (this.videoUploaderEl && !this.uploadInProgress) {
            this.videoUploaderEl.uploadFile(file);
          }
          this.setOverlayActiveState(false);
        }
      );
    }
    setFileReadyState(isReady) {
      if (isReady) {
        this.dropHeadingEl.style.display = "none";
        this.seperatorHeadingEl.style.display = "none";
        this.headingSpan.style.display = "none";
        this.separatorSpan.style.display = "none";
      } else {
        if (this.dropHeadingEl) {
          this.dropHeadingEl.style.display = "block";
          this.dropHeadingEl.style.marginBottom = "12px";
        }
        if (this.seperatorHeadingEl) {
          this.seperatorHeadingEl.style.display = "block";
          this.seperatorHeadingEl.style.marginBottom = "12px";
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
    setOverlayActiveState(isActive) {
      if (isActive) {
        this.dropOverlayEl.style.display = "flex";
      } else {
        this.dropOverlayEl.style.display = "none";
      }
    }
    updateOverlayText() {
      if (this.overlayLabelEl && !this.uploadInProgress) {
        const overlayText = this.getAttribute("overlay-text") || "";
        this.overlayLabelEl.textContent = overlayText;
      }
    }
  };
  if (!browserObject.customElements.get("fp-upload-drop")) {
    browserObject.customElements.define("fp-upload-drop", FpDragComponent);
  }

  // src/uploadsMonitor.ts
  var uploadMonitorComponent = documentInstance.createElement("template");
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
  var FpMonitorComponent = class extends browserObject.HTMLElement {
    constructor() {
      var _a, _b, _c;
      super();
      this.handleUploadStart = () => {
        var _a;
        (_a = this.progressBar) == null ? void 0 : _a.focus();
        this.showProgressElements();
      };
      this.handleProgressEvent = (e) => {
        var _a;
        const percent = e.detail.progress;
        (_a = this.progressBar) == null ? void 0 : _a.setAttribute("aria-valuenow", `${Math.floor(percent)}`);
        if (this.progressBar) {
          this.progressBar.style.width = `${percent}%`;
        }
        if (this.uploadPercentage) {
          this.uploadPercentage.innerHTML = `${Math.floor(percent)}%`;
        }
      };
      this.handleSuccess = () => {
        this.uploadInProgress = false;
        this.hideProgressElements();
      };
      this.handleUploadReset = () => {
        this.uploadInProgress = false;
        if (this.uploadPercentage) {
          this.uploadPercentage.innerHTML = "";
        }
        if (this.progressBar) {
          this.progressBar.style.width = "0%";
        }
        this.hideProgressElements();
      };
      const shadowRoot = this.attachShadow({ mode: "open" });
      shadowRoot.appendChild(uploadMonitorComponent.content.cloneNode(true));
      this.progressBar = (_a = this.shadowRoot) == null ? void 0 : _a.getElementById("monitorProgressBar");
      this.uploadPercentage = (_b = this.shadowRoot) == null ? void 0 : _b.getElementById("progressStatus");
      this.barTypeContainer = (_c = this.shadowRoot) == null ? void 0 : _c.getElementById(
        "progressBarContainer"
      );
      this.uploadInProgress = false;
      if (this.progressBar) {
        this.progressBar.style.width = "0%";
      }
    }
    connectedCallback() {
      this.videoUploaderEl = setupFpUploader(this);
      this.progressTypeAttribute = this.getAttribute("progress-type");
      this.displayProgressBar = this.hasAttribute("file-progress-update");
      if (this.displayProgressBar) {
        if (this.progressBar && this.barTypeContainer && this.progressTypeAttribute === "progress-bar") {
          this.progressBar.style.display = "block";
          this.barTypeContainer.style.display = "block";
        } else if (this.progressBar && this.barTypeContainer && this.progressTypeAttribute === "progress-status") {
          if (this.uploadPercentage) {
            this.uploadPercentage.style.display = "block";
            this.uploadPercentage.innerHTML = "0%";
          }
        }
      }
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
    // Show the progress elements based on the selected type (progress bar or status)
    showProgressElements() {
      if (this.progressBar && this.uploadPercentage && this.barTypeContainer) {
        if (this.progressTypeAttribute === "progress-bar" || this.progressTypeAttribute === null) {
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
  };
  if (!browserObject.customElements.get("fp-upload-monitor")) {
    browserObject.customElements.define("fp-upload-monitor", FpMonitorComponent);
  }

  // src/uploadsStatus.ts
  var uploadStatusComponent = documentInstance.createElement("template");
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
  var FpStatusComponent = class extends browserObject.HTMLElement {
    constructor() {
      var _a;
      super();
      // Clears the status message and hides the status element.
      this.clearStatusElement = () => {
        if (this.statusElement) {
          this.statusElement.style.display = "none";
          this.statusElement.innerHTML = "";
        }
      };
      // Handles when an upload fails.
      this.handleUploadError = (event) => {
        if (this.statusElement) {
          this.statusElement.style.display = "block";
          const customFailureMessage = this.getAttribute("failure-message");
          this.statusElement.innerHTML = customFailureMessage ? customFailureMessage : event.detail.message;
        }
      };
      // Handles when an upload is successful.
      this.handleUploadSuccess = () => {
        const customStatusMessage = this.getAttribute("success-message");
        const successMessage = customStatusMessage ? customStatusMessage : "Upload completed successfully!";
        if (this.statusElement) {
          this.statusElement.style.display = "block";
          this.statusElement.innerHTML = successMessage;
        }
      };
      const shadowRoot = this.attachShadow({ mode: "open" });
      shadowRoot.appendChild(uploadStatusComponent.content.cloneNode(true));
      this.statusElement = (_a = this.shadowRoot) == null ? void 0 : _a.getElementById("status-element");
    }
    connectedCallback() {
      this.uploaderStatusEl = setupFpUploader(this);
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
  };
  if (!browserObject.customElements.get("fp-upload-status")) {
    browserObject.customElements.define("fp-upload-status", FpStatusComponent);
  }

  // src/uploadsRetry.ts
  var uploadRetryComponent = documentInstance.createElement("template");
  uploadRetryComponent.innerHTML = `
    <style>
      .retry-button {
        display:none;
        color: #fff;
        background-color: #ff4d4d;
        border: 2px solid #ff4d4d;
        border-radius: 6px; 
        padding: 10px 20px;
        font-size: inherit;
        font-family: inherit;
        cursor: pointer;
        transition: background-color 0.3s, border-color 0.3s, color 0.3s;
      }

      .retry-button:hover {
        background-color: #ff6666;
        border-color: #ff6666;
      }

      .retry-button:active {
        background-color: #e22c3e;
        border-color: #e22c3e;
      }
      
    </style>

    <slot name="retry-button">
      <button id="default-retry-button" class="retry-button" role="button" tabindex="0">Try again</button>
    </slot>
`;
  var FpRetryComponent = class extends browserObject.HTMLElement {
    constructor() {
      var _a;
      super();
      const shadowRoot = this.attachShadow({ mode: "open" });
      shadowRoot.appendChild(uploadRetryComponent.content.cloneNode(true));
      this.retryButton = shadowRoot.getElementById("default-retry-button");
      this.handleRetryButtonClick = this.handleRetryButtonClick.bind(this);
      (_a = shadowRoot.querySelector("slot")) == null ? void 0 : _a.addEventListener("slotchange", this.handleSlotChange.bind(this));
    }
    connectedCallback() {
      this.videoRetryEl = setupFpUploader(this);
      this.progressErrorAttribute = this.hasAttribute("file-progress-error");
      if (this.progressErrorAttribute) {
        this.showRetryButton();
      }
      if (this.videoRetryEl) {
        this.videoRetryEl.addEventListener(
          "uploadError",
          this.showRetryButton.bind(this)
        );
        this.videoRetryEl.addEventListener(
          "reset",
          this.hideRetryButton.bind(this)
        );
        this.videoRetryEl.addEventListener(
          "progress",
          this.hideRetryButton.bind(this)
        );
        this.videoRetryEl.addEventListener(
          "online",
          this.hideRetryButton.bind(this)
        );
        this.videoRetryEl.addEventListener(
          "offline",
          this.hideRetryButton.bind(this)
        );
        this.videoRetryEl.addEventListener(
          "uploadStart",
          this.hideRetryButton.bind(this)
        );
      }
      if (this.retryButton) {
        this.retryButton.addEventListener("click", this.handleRetryButtonClick);
      }
    }
    handleSlotChange(e) {
      const slot = e.currentTarget;
      this.retryButton = slot.assignedElements({ flatten: true }).filter(
        (el) => !["STYLE"].includes(el.nodeName)
      )[0] || this.shadowRoot.getElementById("default-retry-button");
      if (!this.progressErrorAttribute) {
        this.retryButton.style.display = "none";
      }
      if (this.retryButton) {
        this.retryButton.addEventListener("click", this.handleRetryButtonClick);
      }
    }
    // Handles the retry button click event.
    handleRetryButtonClick() {
      if (this.videoRetryEl) {
        this.videoRetryEl.dispatchEvent(new CustomEvent("reset"));
      }
    }
    // Shows the retry button when an error occurs.
    showRetryButton() {
      if (this.retryButton) {
        this.retryButton.style.display = "inline-block";
      }
    }
    // Hides the retry button when the upload is reset or successful.
    hideRetryButton() {
      if (this.retryButton) {
        if (!this.progressErrorAttribute) {
          this.retryButton.style.display = "none";
        }
      }
    }
  };
  if (!browserObject.customElements.get("fp-upload-retry")) {
    browserObject.customElements.define("fp-upload-retry", FpRetryComponent);
  }

  // src/index.ts
  var FpUploadComponent = class extends browserObject.HTMLElement {
    static get observedAttributes() {
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
        "endpoint"
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
    attributeChangedCallback(_name, _oldValue, _newValue) {
      this.updateComponent();
    }
    initTemplate(shadowRoot) {
      const disableDrop = this.hasAttribute("disable-drop");
      shadowRoot.innerHTML = `
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
    initElements(shadowRoot) {
      var _a, _b;
      this.fileInput = shadowRoot.getElementById(
        "file-input"
      );
      this.mediaSelector = shadowRoot.querySelector('slot[name="upload-file-button"]').assignedElements()[0] || shadowRoot.getElementById("file-select-button-default");
      this.videoUploaderEl = null;
      this.resumableUpload = void 0;
      this.handleFilePickerElClick = this.handleFilePickerElClick.bind(this);
      this.fileInput = shadowRoot.getElementById("file-input");
      if (this.fileInput) {
        this.fileInput.addEventListener("change", (event) => {
          const target = event.target;
          const files = target == null ? void 0 : target.files;
          if (files.length > 0) {
            this.uploadFile(files[0]);
          }
        });
      }
      (_b = (_a = this.shadowRoot) == null ? void 0 : _a.querySelector("slot")) == null ? void 0 : _b.addEventListener("slotchange", (e) => {
        const slot = e.currentTarget;
        const newFilePickerEl = slot.assignedElements({ flatten: true }).filter(
          (el) => !["STYLE"].includes(el.nodeName)
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
      if (this.mediaSelector && !shadowRoot.querySelector('slot[name="upload-file-button"]').assignedElements()[0]) {
        this.mediaSelector.addEventListener(
          "click",
          this.handleFilePickerElClick.bind(this)
        );
      }
    }
    initializeComponent() {
      this.videoUploaderEl = setupFpUploader(this);
      if (this.videoUploaderEl) {
        this.videoUploaderEl.addEventListener(
          "fileReady",
          () => this.setFileReadyState(true)
        );
        this.videoUploaderEl.addEventListener(
          "uploadStart",
          () => this.setFileReadyState(true)
        );
        this.videoUploaderEl.addEventListener("reset", () => {
          this.setFileReadyState(false);
        });
        this.videoUploaderEl.addEventListener(
          "uploadError",
          () => this.toggleRetryUpload(true)
        );
        this.videoUploaderEl.addEventListener(
          "progress",
          () => this.toggleRetryUpload(false)
        );
        this.videoUploaderEl.addEventListener(
          "success",
          () => this.toggleRetryUpload(false)
        );
      }
    }
    handleFilePickerElClick() {
      if (this.fileInput) {
        this.fileInput.click();
      }
    }
    updateComponent() {
      const shadowRoot = this.shadowRoot;
      this.initTemplate(shadowRoot);
      this.initElements(shadowRoot);
      this.initializeComponent();
    }
    emitEvent(eventName, detail) {
      this.dispatchEvent(new CustomEvent2(eventName, detail));
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
    toggleRetryUpload(retry) {
      const uploadRetry = this.shadowRoot.getElementById(
        "upload-retry"
      );
      if (uploadRetry) {
        uploadRetry.style.marginTop = retry ? "10px" : "0px";
        uploadRetry.style.marginBottom = retry ? "10px" : "0px";
      }
    }
    setFileReadyState(isReady) {
      if (isReady) {
        this.hideUploadButtons();
      } else {
        this.resetFileInput();
        this.showUploadButtons();
        this.retryUpload();
      }
    }
    setOverlayActiveState(isActive) {
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
    uploadFile(file) {
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
            message: `Unable to proceed without a specified URL or endpoint for handling the upload`
          }
        });
        return;
      }
      try {
        this.emitEvent("uploadStart", { detail: file });
        if (endpoint && file) {
          this.resumableUpload = Uploader.init({
            endpoint,
            file,
            chunkSize: parseInt(chunkSize),
            maxFileSize: parseInt(maxFileSize)
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
      this.resumableUpload.on("chunkAttempt", (event) => {
        this.emitEvent("chunkAttempt", event);
      });
      this.resumableUpload.on("chunkSuccess", (event) => {
        this.emitEvent("chunkSuccess", event);
      });
      this.resumableUpload.on("progress", (event) => {
        this.emitEvent("progress", { detail: event.detail });
      });
      this.resumableUpload.on("success", (success) => {
        this.emitEvent("success", success);
        this.retryUpload();
      });
      this.resumableUpload.on("online", (event) => {
        this.emitEvent("online", event);
      });
      this.resumableUpload.on("offline", (event) => {
        this.emitEvent("offline", event);
      });
      this.resumableUpload.on("error", (event) => {
        console.log("errorEvent:", event);
        this.emitEvent("uploadError", event);
      });
      this.resumableUpload.on("attemptFailure", (event) => {
        this.emitEvent("chunkAttemptFailure", event);
      });
    }
  };
  if (!browserObject.customElements.get("fp-upload")) {
    browserObject.customElements.define("fp-upload", FpUploadComponent);
  }
})();
