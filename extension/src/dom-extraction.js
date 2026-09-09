function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
    );
}


function extractElement(element) {
    const rect = element.getBoundingClientRect();

    return {
        element: element,

        tag: element.tagName.toLowerCase(),
        type: element.type || null,

        text: element.innerText || "",
        value: element.value || "",

        name: element.name || "",
        id: element.id || "",

        position: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
        }
    };
}

function extractDOM() {

    const elements = Array.from(
        document.querySelectorAll(
            "button, input, textarea, select, a, label, " +
            "h1, h2, h3, h4, h5, h6, p, span, li"
        )
    ).filter(isVisible);

    return elements.map(extractElement);
}

export { extractDOM };