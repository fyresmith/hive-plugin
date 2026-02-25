const BANNER_ID = 'hive-reconnect-banner';

export class ReconnectBanner {
  private el: HTMLElement | null = null;

  show(onReconnectNow: () => void): void {
    this.hide();

    const banner = document.createElement('div');
    banner.id = BANNER_ID;

    const text = document.createElement('span');
    text.className = 'hive-reconnect-text';
    text.innerHTML = '⬡ Hive disconnected — reconnecting<span class="hive-reconnect-dots">...</span>';

    const btn = document.createElement('button');
    btn.className = 'hive-reconnect-btn';
    btn.textContent = 'Try now';
    btn.addEventListener('click', onReconnectNow);

    banner.appendChild(text);
    banner.appendChild(btn);
    document.body.appendChild(banner);
    this.el = banner;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
    document.getElementById(BANNER_ID)?.remove();
  }
}
