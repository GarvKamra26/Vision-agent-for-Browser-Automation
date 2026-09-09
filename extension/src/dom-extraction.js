function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
    );
}

function extractDOM() {
    const elements = Array.from(
        document.querySelectorAll(
            "button, input, textarea, select, a, label, h1, h2, h3"
        )
    ).filter(isVisible);

    return elements.map((element) => {
        const rect = element.getBoundingClientRect();

        return {
            tag: element.tagName.toLowerCase(),
            type: element.type || null,
            text: element.innerText || null,
            name: element.name || null,
            id: element.id || null,
            position: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            }
        };
    });
}

export {extractDOM};