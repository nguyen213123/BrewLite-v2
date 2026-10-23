'use client';

import { useState } from 'react';

interface Props {
  src: string;
  alt: string;
  className?: string;
}

/** Ảnh sản phẩm; nếu ảnh lỗi hoặc thiếu thì hiện biểu tượng ly cà phê thay thế. */
export function ProductImage({ src, alt, className = '' }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div role="img" aria-label={alt} className={`flex items-center justify-center bg-brew-line/60 text-brew-ink ${className}`}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z" />
          <path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17" />
          <path d="M8 3v2M12 3v2" />
        </svg>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- imageUrl là URL tuyệt đối do API trả về, chưa cấu hình next/image remotePatterns
    <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />
  );
}
