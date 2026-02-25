const BANNER_ID = 'hive-follow-banner';

export class FollowBanner {
  private el: HTMLElement | null = null;
  private stopHandler: (() => void) | null = null;

  show(username: string, onStop: () => void): void {
    this.hide();
    this.stopHandler = onStop;

    const banner = document.createElement('div');
    banner.id = BANNER_ID;

    const text = document.createElement('span');
    text.className = 'hive-follow-text';
    text.innerHTML = `Following <strong>@${username}</strong>`;

    const btn = document.createElement('button');
    btn.className = 'hive-follow-stop-btn';
    btn.textContent = 'Stop';
    btn.addEventListener('click', () => {
      onStop();
      this.hide();
    });

    banner.appendChild(text);
    banner.appendChild(btn);
    document.body.appendChild(banner);
    this.el = banner;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
    this.stopHandler = null;
    document.getElementById(BANNER_ID)?.remove();
  }

  updateUser(username: string): void {
    const strong = this.el?.querySelector('.hive-follow-text strong');
    if (strong) strong.textContent = `@${username}`;
  }
}
