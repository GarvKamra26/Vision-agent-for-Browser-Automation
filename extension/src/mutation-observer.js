function startDOMObserver(callback) {

    const observer = new MutationObserver((mutations) => {

        callback(mutations);

    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
    });

    return observer;
}

function getChangedElements(mutations) {

    const elements = new Set();

    for (const mutation of mutations) {

        if (mutation.type === "characterData") {

            if (mutation.target.parentElement) {
                elements.add(mutation.target.parentElement);
            }

        }

        if (mutation.type === "attributes") {

            elements.add(mutation.target);

        }

        if (mutation.type === "childList") {

            mutation.addedNodes.forEach(node => {

                if (node.nodeType === Node.ELEMENT_NODE) {
                    elements.add(node);
                }

            });

        }

    }

    return [...elements];
}

export {getChangedElements, startDOMObserver};