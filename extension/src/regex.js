const SENSITIVE_PATTERNS = {
    email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    phone: /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/g,
    aadhaar: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g,
    pan: /\b[A-Z]{5}\d{4}[A-Z]\b/gi,
    creditCard: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g,
    ifsc: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,
    passport: /\b[A-Z][0-9]{7}\b/gi
};


function detectPII(text) {
    const detections = [];

    for (const [type, regex] of Object.entries(SENSITIVE_PATTERNS)) {

        regex.lastIndex = 0;

        let match;

        while ((match = regex.exec(text)) !== null) {

            detections.push({
                type: type,
            });
        }
    }

    return detections;
}

function detectSensitiveElements(domElements) {

    const sensitiveElements = [];

    for (const item of domElements) {

        // Password detection
        if (
            item.tag === "input" &&
            item.type === "password"
        ) {
            sensitiveElements.push({
                ...item,
                reasons: ["password"]
            });

            continue;
        }

        //email detection
        if (
            item.tag === "input" &&
            item.type === "text" &&
            (
                item.name === "login" ||
                item.name === "login_field" ||
                item.name === "email"
            )
        ) {
            sensitiveElements.push({
                ...item,
                reasons: ["email"]
            });

            continue;
        }

        // Check all locally available text
        const text = [
            item.text,
            item.value,
            item.name,
            item.id
        ]
            .filter(Boolean)
            .join(" ");

        const detections = detectPII(text);

        if (detections.length > 0) {

            sensitiveElements.push({
                ...item,

                reasons: [
                    ...new Set(
                        detections.map(
                            detection => detection.type
                        )
                    )
                ]
            });
        }
    }

    return sensitiveElements;
}


export { detectPII, detectSensitiveElements };