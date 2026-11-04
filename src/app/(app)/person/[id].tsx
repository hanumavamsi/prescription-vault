import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

/** Old links: everyone's records now live on Home, picked from the people row. */
export default function PersonRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/', params: { person: id } } as Href} />;
}
