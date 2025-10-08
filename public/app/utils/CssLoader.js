// [CoreDNA] This module's sole responsibility is to dynamically load CSS files.
// It ensures all stylesheets are loaded before resolving a promise,
// allowing dependent scripts to execute only after styles are applied.

export function load(cssFiles = []) {
    // [HCA] Create a single promise that resolves when all individual link-loading promises are done.
    return Promise.all(
        cssFiles.map(cssFile => createLinkPromise(cssFile))
    );
}

// [HCA] Encapsulates the logic for creating and managing a single <link> element's lifecycle.
function createLinkPromise(cssFile) {
    return new Promise((resolve, reject) => {
        // [VPC] Use clear, descriptive variable names.
        const linkElement = document.createElement('link');
        linkElement.rel = 'stylesheet';
        linkElement.href = cssFile;
        linkElement.type = 'text/css';

        // [CoreDNA] The core logic relies on the 'load' and 'error' events to manage the promise state.
        linkElement.onload = () => {
            // console.log(`[CssLoader] Successfully loaded: ${cssFile}`);
            resolve();
        };

        linkElement.onerror = () => {
            console.error(`[CssLoader] Failed to load: ${cssFile}`);
            reject(new Error(`Failed to load stylesheet: ${cssFile}`));
        };

        document.head.appendChild(linkElement);
    });
}
