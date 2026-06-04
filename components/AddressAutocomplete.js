/**
 * components/AddressAutocomplete.js
 * Google Places Autocomplete for property address fields.
 *
 * Usage:
 *   <AddressAutocomplete
 *     value={property}
 *     onChange={val => setProperty(val)}
 *     placeholder="e.g. 412 Elm St, 3BR in Hyde Park"
 *   />
 *
 * Requires NEXT_PUBLIC_GOOGLE_PLACES_KEY in your env.
 * Restrict the key in Google Cloud Console to:
 *   - Places API
 *   - HTTP referrers: sayhelloleads.com/*
 */

import { useEffect, useRef, useState } from 'react';

let scriptLoaded  = false;
let scriptLoading = false;
const callbacks   = [];

function loadGoogleScript(apiKey) {
  return new Promise((resolve) => {
    if (scriptLoaded) { resolve(); return; }
    callbacks.push(resolve);
    if (scriptLoading) return;
    scriptLoading = true;

    window.__googlePlacesInit = () => {
      scriptLoaded = true;
      callbacks.forEach(cb => cb());
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=__googlePlacesInit`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  });
}

export default function AddressAutocomplete({ value, onChange, placeholder, className, style }) {
  const inputRef = useRef(null);
  const acRef    = useRef(null);
  const [ready, setReady] = useState(false);
  const apiKey   = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;

  // Load Google script once
  useEffect(() => {
    if (!apiKey || typeof window === 'undefined') return;
    loadGoogleScript(apiKey).then(() => setReady(true));
  }, [apiKey]);

  // Attach autocomplete once script ready
  useEffect(() => {
    if (!ready || !inputRef.current || acRef.current) return;

    acRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address', 'name'],
    });

    acRef.current.addListener('place_changed', () => {
      const place = acRef.current.getPlace();
      const address = place.formatted_address || place.name || inputRef.current.value;
      onChange(address);
    });

    // Prevent form submit on Enter while dropdown is open
    inputRef.current.addEventListener('keydown', e => {
      if (e.key === 'Enter') e.preventDefault();
    });
  }, [ready]);

  // Sync input value when changed externally
  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = value || '';
    }
  }, [value]);

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || 'Enter property address'}
      className={className}
      style={style}
      autoComplete="off"
    />
  );
}
