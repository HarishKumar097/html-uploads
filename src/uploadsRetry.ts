import { browserObject, documentInstance, setupFpUploader } from "./customElements";


// Define a template for retry upload button component
const uploadRetryComponent: HTMLTemplateElement = documentInstance.createElement("template");

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

class FpRetryComponent extends browserObject.HTMLElement {
    retryButton: HTMLElement | null;
    videoRetryEl: HTMLElement | null | undefined;
    progressErrorAttribute: boolean | undefined;
    shadowRoot: ShadowRoot | any;

    constructor() {
        super();
        const shadowRoot: ShadowRoot | any = this.attachShadow({ mode: "open" });
        shadowRoot.appendChild(uploadRetryComponent.content.cloneNode(true));

        this.retryButton = shadowRoot.getElementById("default-retry-button");
        this.handleRetryButtonClick = this.handleRetryButtonClick.bind(this);

         // Listen for slot changes to handle dynamic content.
        shadowRoot
            .querySelector("slot")
            ?.addEventListener("slotchange", this.handleSlotChange.bind(this));
    }

    connectedCallback() {
        this.videoRetryEl = setupFpUploader(this);
        this.progressErrorAttribute = this.hasAttribute("file-progress-error");

        if (this.progressErrorAttribute) {
            this.showRetryButton();
        }
        
        // Event listeners for handling upload events.
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

    handleSlotChange(e: Event) {
        const slot = e.currentTarget as HTMLSlotElement;
        this.retryButton =
            (slot
                .assignedElements({ flatten: true })
                .filter(
                    (el: Element) => !["STYLE"].includes(el.nodeName)
                )[0] as HTMLElement | null) ||
            this.shadowRoot.getElementById("default-retry-button");

        if (!this.progressErrorAttribute) {
            (this.retryButton as HTMLElement).style.display = "none";
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
}

if (!browserObject.customElements.get("fp-upload-retry")) {
    browserObject.customElements.define("fp-upload-retry", FpRetryComponent);
}
