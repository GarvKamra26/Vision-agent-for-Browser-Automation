import { extractDOM } from "./dom-extraction.js";
import { detectSensitiveElements } from "./regex.js";
import {
    getChangedElements,
    startDOMObserver
} from "./mutation-observer.js";

const sensitiveElements = new Map();
const pageElements = extractDOM();
const initialSensitiveElements = detectSensitiveElements(pageElements);


for (const item of initialSensitiveElements) {

    sensitiveElements.set(item.element, item);
}

startDOMObserver((mutations) => {

    const changedElements = getChangedElements(mutations);

    if (changedElements.length === 0) {
        return;
    }

    const changedSensitiveElements =
        detectSensitiveElements(changedElements);

    const checkedElements = new Set(
        changedElements.map(item => item.element)
    );

    for (const element of checkedElements) {

        if (!changedSensitiveElements.some(
            item => item.element === element
        )) {

            sensitiveElements.delete(element);
        }
    }

    for (const item of changedSensitiveElements) {

        sensitiveElements.set(
            item.element,
            item
        );
    }

});
