const canvas = document.querySelector("#game-board");
const context = canvas.getContext("2d");
const scoreElement = document.querySelector("#score");
const statusMessage = document.querySelector("#status-message");
const startButton = document.querySelector("#start-button");
const restartButton = document.querySelector("#restart-button");

const cellSize = 24;
const boardSize = canvas.width / cellSize;

let score = 0;
let isRunning = false;

function drawBoard() {
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.fillStyle = "#0b1012";
	context.fillRect(0, 0, canvas.width, canvas.height);

	context.strokeStyle = "#26343b";
	context.lineWidth = 1;

	for (let cell = 0; cell <= boardSize; cell += 1) {
		const position = cell * cellSize;
		context.beginPath();
		context.moveTo(position, 0);
		context.lineTo(position, canvas.height);
		context.stroke();

		context.beginPath();
		context.moveTo(0, position);
		context.lineTo(canvas.width, position);
		context.stroke();
	}
}

function updateScore(nextScore) {
	score = nextScore;
	scoreElement.textContent = String(score);
}

function setStatus(message) {
	statusMessage.textContent = message;
}

function startGame() {
	isRunning = true;
	updateScore(0);
	setStatus("Game ready. Movement comes next.");
	drawBoard();
}

function restartGame() {
	startGame();
}

startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", restartGame);

drawBoard();
