import { Link } from 'react-router-dom';

/**
 * The source PNG is a 2000x2000 square whose artwork only occupies a middle
 * band, so sizing it by height alone renders a tiny wordmark surrounded by
 * transparent padding. These ratios describe where the artwork actually sits
 * so the component can crop that padding away and size by the *wordmark*.
 *
 * If the logo file is ever replaced, re-measure these two numbers.
 */
const ART_HEIGHT_RATIO = 0.42;  // artwork height / image height
const ART_CENTER_Y = 0.47;      // vertical centre of the artwork, 0-1
const ART_WIDTH_RATIO = 0.88;   // artwork width / image width

/** Rendered wordmark height in px, per size token. */
const SIZES = { sm: 26, md: 34, lg: 48, xl: 76 };

/**
 * The wordmark is dark navy on transparency, so it must sit on a light
 * surface. On a dark panel, put it on a white plate first.
 */
export default function Logo({ size = 'md', to = '/home', className = '', linked = true }) {
  const artHeight = SIZES[size] || SIZES.md;
  const imageSize = artHeight / ART_HEIGHT_RATIO;
  const boxWidth = imageSize * ART_WIDTH_RATIO;
  const offsetTop = -(imageSize * ART_CENTER_Y - artHeight / 2);
  const offsetLeft = -((imageSize - boxWidth) / 2);

  const mark = (
    <span
      className={`block shrink-0 overflow-hidden ${className}`}
      style={{ height: `${artHeight}px`, width: `${boxWidth}px` }}
    >
      <img
        src="/logo.png"
        alt="GetFame 360 Growth Services"
        width={imageSize}
        height={imageSize}
        className="block max-w-none"
        style={{
          height: `${imageSize}px`,
          width: `${imageSize}px`,
          marginTop: `${offsetTop}px`,
          marginLeft: `${offsetLeft}px`,
        }}
      />
    </span>
  );

  if (!linked) return mark;

  return (
    <Link to={to} className="inline-flex items-center rounded-lg" aria-label="GetFame 360 home">
      {mark}
    </Link>
  );
}
