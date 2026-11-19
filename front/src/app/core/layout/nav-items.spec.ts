import { arrangeNav, type NavItem, orderNav } from './nav-items';

const item = (route: string): NavItem => ({ label: route, icon: '', route, shortcut: route });
const ITEMS = [item('/a'), item('/b'), item('/c'), item('/d')];
const routes = (items: readonly NavItem[]): string[] => items.map((entry) => entry.route);

describe('orderNav', () => {
  it('keeps the default order without a saved one', () => {
    expect(routes(orderNav(ITEMS, []))).toEqual(['/a', '/b', '/c', '/d']);
  });

  it('follows the saved order', () => {
    expect(routes(orderNav(ITEMS, ['/d', '/c', '/b', '/a']))).toEqual(['/d', '/c', '/b', '/a']);
  });

  it('puts routes missing from the order after, in default order, and ignores stale routes', () => {
    expect(routes(orderNav(ITEMS, ['/c', '/gone', '/a']))).toEqual(['/c', '/a', '/b', '/d']);
  });
});

describe('arrangeNav', () => {
  it('drops hidden routes', () => {
    expect(routes(arrangeNav(ITEMS, ['/b', '/a'], ['/a', '/d']))).toEqual(['/b', '/c']);
  });
});
