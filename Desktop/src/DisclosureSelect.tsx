import type { ComponentPropsWithoutRef } from 'react';
import { DisclosureChevron } from './DisclosureChevron';

export function DisclosureSelect(props: ComponentPropsWithoutRef<'select'>) {
  return <span className="appearance-select disclosure-select"><select {...props}/><DisclosureChevron/></span>;
}
