const roomTabs = document.querySelectorAll('[data-room-tab]');
const roomFrames = document.querySelectorAll('[data-room-frame]');

function activateRoom(roomNumber) {
    roomTabs.forEach(tab => {
        const active = Number(tab.dataset.roomTab) === roomNumber;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
    roomFrames.forEach(frame => {
        frame.hidden = Number(frame.dataset.roomFrame) !== roomNumber;
    });
}

roomTabs.forEach(tab => {
    tab.addEventListener('click', () => activateRoom(Number(tab.dataset.roomTab)));
});

activateRoom(1);
