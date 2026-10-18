import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { colorForName, readableTextColor } from '@domain/color';

const INITIALS = 2;
const DEFAULT_SIZE = 32;

/** Contact photo with an initials fallback (deterministic color). */
@Component({
  selector: 'ac-contact-avatar',
  template: `
    <span
      class="avatar"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.background]="color()"
      [style.color]="textColor()"
    >
      @if (showPhoto()) {
        <img [src]="photoUrl()" alt="" (error)="showPhoto.set(false)" />
      } @else {
        <span [style.font-size.px]="size() * 0.4">{{ initials() }}</span>
      }
    </span>
  `,
  styles: `
    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      border-radius: 50%;
      overflow: hidden;
      font-weight: 600;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactAvatarComponent {
  /** Contact id. */
  readonly contactId = input.required<string>();
  /** Contact name. */
  readonly name = input.required<string>();
  /** Diameter in pixels. */
  readonly size = input(DEFAULT_SIZE);
  /** Cache buster after a photo upload. */
  readonly version = input(0);

  protected readonly showPhoto = linkedSignal({
    source: () => [this.contactId(), this.version()],
    computation: () => true,
  });
  protected readonly photoUrl = computed(
    () => `/api/contact/${this.contactId()}/photo?v=${String(this.version())}`,
  );
  protected readonly color = computed(() => colorForName(this.name()));
  protected readonly textColor = computed(() => readableTextColor(this.color()));
  protected readonly initials = computed(() =>
    this.name()
      .split(/\s+/)
      .filter((part) => part !== '')
      .slice(0, INITIALS)
      .map((part) => part.charAt(0).toUpperCase())
      .join(''),
  );
}
