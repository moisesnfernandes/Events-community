// Sistema de Notificações Toast
class Toast {
  constructor(message, type = 'info', duration = 3000) {
    this.message = message;
    this.type = type; // 'info', 'success', 'warning', 'error'
    this.duration = duration;
    this.create();
  }

  create() {
    const container = document.getElementById('toastContainer') || this.createContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${this.type}`;
    toast.textContent = this.message;
    
    container.appendChild(toast);
    
    // Animação de entrada
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Auto-remove
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, this.duration);
  }

  createContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(container);
    return container;
  }
}

// Funções de notificação
function notifySuccess(msg) {
  new Toast(msg, 'success', 2500);
}

function notifyError(msg) {
  new Toast(msg, 'error', 3000);
}

function notifyInfo(msg) {
  new Toast(msg, 'info', 2500);
}

function notifyWarning(msg) {
  new Toast(msg, 'warning', 3000);
}

function notifyPlayerCalled(playerName) {
  new Toast(`🎮 ${playerName} foi chamado!`, 'info', 4000);
}

function notifyScoreUpdate(playerName, score) {
  new Toast(`⭐ ${playerName} fez ${score} pontos!`, 'success', 3000);
}
