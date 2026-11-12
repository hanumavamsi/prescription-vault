import { fireEvent, render, screen } from '@testing-library/react-native';

import { DocRow } from '@/components/doc-row';
import { formatDate } from '@/components/ui';

import { doc } from './fixtures';

describe('<DocRow />', () => {
  it('shows the title with type, specialty, doctor, date and page count', async () => {
    await render(
      <DocRow doc={doc({ title: 'BP check', specialty: 'Cardiology', doctor: 'Dr. Mehta', page_count: 3 })} onPress={() => {}} />,
    );
    expect(screen.getByText('BP check')).toBeTruthy();
    expect(screen.getByText(`Prescription · Cardiology · Dr. Mehta · ${formatDate('2026-11-04')} · 3 pages`)).toBeTruthy();
  });

  it('falls back to the type when there is no title, and is tappable', async () => {
    const onPress = jest.fn();
    await render(<DocRow doc={doc({ type: 'report', title: '  ', page_count: 1 })} onPress={onPress} />);
    fireEvent.press(screen.getByText('Report'));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByText(`${formatDate('2026-11-04')} · 1 page`)).toBeTruthy();
  });

  it('marks "Only me" documents', async () => {
    await render(<DocRow doc={doc({ private: true })} onPress={() => {}} />);
    expect(screen.getByText(`Only me · ${formatDate('2026-11-04')} · 1 page`)).toBeTruthy();
  });
});
