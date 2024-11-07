// Variables to hold the cipher and phrases
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const symbols = "@#$%^&*!";
const digits = "0123456789";
const cipherKey = generateCipherKey();
const missingCharacters = selectMissingCharacters(6); // Six missing characters

// Define the hint and passphrase
const hintPlaintext = "ZYPHRAX JUMPED QUICKLY OVER FIVE GLOWING BLORX PODS WITH UNMATCHED SKILL";
const encryptedHint = encryptText(hintPlaintext);
const longPassphrase = "JAX QUIZED VIBRANTLY WHILE FLYING PLOWGX DRONE SKH";
const encryptedPassphrase = encryptText(longPassphrase);

document.getElementById("hint-plaintext").innerText = hintPlaintext;
document.getElementById("hint-encrypted").innerText = encryptedHint;
populateCipherTable(cipherKey, missingCharacters);
document.getElementById("passphrase-encrypted").innerText = encryptedPassphrase;

function generateCipherKey() {
    const shuffled = (alphabet + symbols + digits).split('').sort(() => Math.random() - 0.5);
    const key = {};
    alphabet.split('').forEach((letter, index) => {
        key[letter] = shuffled[index];
    });
    return key;
}

function selectMissingCharacters(count) {
    const keys = Object.keys(cipherKey);
    const selected = [];
    while (selected.length < count) {
        const char = keys[Math.floor(Math.random() * keys.length)];
        if (!selected.includes(char)) {
            selected.push(char);
        }
    }
    return selected;
}

function populateCipherTable(key, missingChars) {
    const table = document.getElementById("cipher-key-table");
    let row = document.createElement("tr");

    Object.keys(key).forEach((letter, index) => {
        let cell = document.createElement("td");
        if (missingChars.includes(letter)) {
            const input = document.createElement("input");
            input.type = "text";
            input.classList.add("missing-input");
            input.maxLength = 1;
            input.setAttribute("data-letter", letter);
            cell.innerHTML = `${letter} = `;
            cell.appendChild(input);
        } else {
            cell.innerText = `${letter} = ${key[letter]}`;
        }

        row.appendChild(cell);
        if ((index + 1) % 6 === 0) {
            table.appendChild(row);
            row = document.createElement("tr");
        }
    });
    table.appendChild(row);
}

function encryptText(text) {
    let encrypted = "";
    for (let char of text) {
        encrypted += cipherKey[char] || char;
    }
    return encrypted;
}

function checkLayer1() {
    const passphraseInput = document.getElementById("layer1-passphrase-input").value.toLowerCase();
    if (passphraseInput !== longPassphrase.toLowerCase()) {
        document.getElementById("layer1-result").innerText = "Incorrect passphrase, try again!";
        return;
    }

    document.getElementById("layer1-result").innerText = "Correct! Proceeding to Layer 2...";
    setTimeout(() => {
        document.getElementById("layer-1").classList.add("hidden");
        document.getElementById("layer-2").classList.remove("hidden");
    }, 1500); // 1.5-second delay before switching layers
}



let storedRandomNumber = "";

function startMemoryChallenge() {
    storedRandomNumber = generateRandomNumberSequence(10, 15);

    // Split the stored number into two halves
    const midPoint = Math.floor(storedRandomNumber.length / 2);
    const firstHalf = storedRandomNumber.slice(0, midPoint);
    const secondHalf = storedRandomNumber.slice(midPoint);

    // Show the first half for 5 seconds
    document.getElementById("random-numbers").innerText = firstHalf;
    setTimeout(() => {
        // Clear the display for a moment to add suspense
        document.getElementById("random-numbers").innerText = "";

        // Show the second half after 1 second, then hide it after 5 more seconds
        setTimeout(() => {
            document.getElementById("random-numbers").innerText = secondHalf;
            setTimeout(() => {
                document.getElementById("random-numbers").innerText = "";
                document.getElementById("memory-inputs").classList.remove("hidden");
            }, 5000);
        }, 1000); // Brief 1-second pause between halves
    }, 5000); // Show the first half for 5 seconds
}

function generateRandomNumberSequence(min, max) {
    const length = Math.floor(Math.random() * (max - min + 1)) + min;
    let sequence = "";
    for (let i = 0; i < length; i++) {
        sequence += Math.floor(Math.random() * 10).toString();
    }
    return sequence;
}

function checkLayer2() {
    const input = document.getElementById("memory-answer").value;
    if (input === storedRandomNumber) {
        document.getElementById("layer2-result").innerText = "Correct! Proceed to Layer 3.";
        setTimeout(() => {
            document.getElementById("layer-2").classList.add("hidden");
            document.getElementById("layer-3").classList.remove("hidden");
        }, 1500); // 1.5-second delay before switching layers
    } else {
        document.getElementById("layer2-result").innerText = "Incorrect, try again!";
    }
}





// Correct binary sequence for Layer 3
const correctSwitchCode = "1101010011";

// Generate 10 switches for Layer 3
function createSwitches() {
    const switchContainer = document.getElementById("switch-container");
    for (let i = 0; i < 10; i++) {
        const switchElement = document.createElement("div");
        switchElement.classList.add("switch");

        const label = document.createElement("label");
        label.innerText = `${i + 1}`;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.classList.add("switch-checkbox");
        checkbox.setAttribute("data-index", i);

        switchElement.appendChild(label);
        switchElement.appendChild(checkbox);
        switchContainer.appendChild(switchElement);
    }
}

// Call the function to create switches when the page loads
createSwitches();

// Check Layer 3 switch configuration
function checkLayer3() {
    let userCode = "";

    // Retrieve each switch state and build a binary string
    document.querySelectorAll(".switch-checkbox").forEach((checkbox, index) => {
        userCode += checkbox.checked ? "1" : "0";
    });

    if (userCode === correctSwitchCode) {
        document.getElementById("layer3-result").innerText = "Correct! Proceed to Layer 4.";
        setTimeout(() => {
            document.getElementById("layer-3").classList.add("hidden");
            document.getElementById("layer-4").classList.remove("hidden");
        }, 1500);
    } else {
        document.getElementById("layer3-result").innerText = "Incorrect, try again!";
    }
}





// Set up the original encoded message for Layer 4
const originalEncodedMessage = "HMZQIY ESPOFT KVNQ";
const finalPassphrase = "GLYPHX DRONES JUMP"; // Final passphrase to decode

// Step 1: Initial Caesar Shift (+8)
function caesarShift(text, shift) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return text.split("").map(char => {
        if (alphabet.includes(char)) {
            let shiftedIndex = (alphabet.indexOf(char) + shift) % 26;
            return alphabet[shiftedIndex];
        }
        return char;
    }).join("");
}

// Generate the intermediate encoded text by shifting the original message by +8
const intermediateEncodedText = caesarShift(originalEncodedMessage, 8);

// Identify the key letter for the second Caesar shift (e.g., using the second letter in the result)
const keyLetter = intermediateEncodedText[1]; // Select the second letter
const secondShift = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(keyLetter) + 1 - 1; // Adjust by subtracting 1

// Perform the second Caesar shift to get the final decoded passphrase
const finalDecodedMessage = caesarShift(intermediateEncodedText, -secondShift); // Apply reverse shift to decode

console.log("Intermediate Encoded Text (Shift by 8):", intermediateEncodedText);
console.log("Key Letter:", keyLetter, "Second Shift:", secondShift);
console.log("Final Decoded Message:", finalDecodedMessage);

// Check Layer 4 solution
function checkLayer4() {
    const input = document.getElementById("layer4-input").value.toUpperCase();
    if (input === finalPassphrase) {
        document.getElementById("layer4-result").innerText = "Correct! Proceed to the Final Layer.";
        setTimeout(() => {
            document.getElementById("layer-4").classList.add("hidden");
            document.getElementById("final-layer").classList.remove("hidden");
        }, 1500); // 1.5-second delay before switching layers
    } else {
        document.getElementById("layer4-result").innerText = "Incorrect, try again!";
    }
}





// Correct passphrase for the final layer
const endResult = "ZORBX SHIPS GLIDE";

// Grid content with the correct letters placed strategically
const gridContent = [
    ["#", "L", "!", "Q", "Z", "#"],
    ["@", "B", "%", "Y", "O", "*"],
    ["P", "!", "S", "K", "H", "$"],
    ["#", "G", "L", "I", "D", "@"],
    ["%", "R", "*", "N", "X", "^"],
    ["!", "D", "E", "O", "V", "!"]
];

// Function to generate the grid on the page
function createGrid() {
    const gridContainer = document.getElementById("grid-container");
    gridContainer.innerHTML = ""; // Clear previous content

    for (let row = 0; row < gridContent.length; row++) {
        for (let col = 0; col < gridContent[row].length; col++) {
            const cell = document.createElement("div");
            cell.classList.add("grid-cell");
            cell.innerText = gridContent[row][col];
            gridContainer.appendChild(cell);
        }
    }
}

// Call createGrid when the page loads
createGrid();

// Check final layer passphrase
function checkFinalLayer() {
    const input = document.getElementById("final-input").value.toUpperCase();
    if (input === endResult) {
        document.getElementById("final-result").innerText = "Congratulations! You've decrypted the data!";
    } else {
        document.getElementById("final-result").innerText = "Incorrect, try again!";
    }
}
