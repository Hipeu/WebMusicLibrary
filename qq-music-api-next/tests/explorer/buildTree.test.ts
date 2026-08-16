import type { ApiExplorerEndpoint } from '../../src/config/apiExplorer';
import {
  buildExplorerTreeFromEndpoints,
  createExplorerEndpointNode,
  createExplorerGroupId,
  createExplorerSearchableText,
} from '../../src/explorer/domain';

const createEndpoint = (overrides: Partial<ApiExplorerEndpoint> = {}): ApiExplorerEndpoint => ({
  id: 'get-search-by-key',
  name: 'getSearchByKey',
  category: 'Search',
  description: 'Search songs by keyword.',
  method: 'GET',
  routePath: '/getSearchByKey/:key?',
  path: '/getSearchByKey',
  ...overrides,
});

describe('buildExplorerTree', () => {
  it('应生成稳定的分组 id', () => {
    expect(createExplorerGroupId('Song Lists')).toBe('group:song-lists');
    expect(createExplorerGroupId('  ')).toBe('group:uncategorized');
  });

  it('应生成可用于搜索的归一化文本', () => {
    const endpoint = createEndpoint({
      description: 'Search songs and singers.',
    });

    expect(createExplorerSearchableText(endpoint)).toBe(
      'getsearchbykey search /getsearchbykey get search songs and singers.',
    );
  });

  it('应将 endpoint 转换为接口树节点', () => {
    const endpoint = createEndpoint();

    expect(createExplorerEndpointNode(endpoint)).toEqual({
      id: 'get-search-by-key',
      type: 'endpoint',
      label: 'getSearchByKey',
      endpointId: 'get-search-by-key',
      category: 'Search',
      method: 'GET',
      path: '/getSearchByKey',
      searchableText: 'getsearchbykey search /getsearchbykey get search songs by keyword.',
    });
  });

  it('应按分类构建分组并保持接口顺序', () => {
    const tree = buildExplorerTreeFromEndpoints([
      createEndpoint(),
      createEndpoint({
        id: 'get-song-info',
        name: 'getSongInfo',
        category: 'Song',
        description: 'Get song detail.',
        path: '/getSongInfo',
        routePath: '/getSongInfo/:songmid?',
      }),
      createEndpoint({
        id: 'get-smartbox',
        name: 'getSmartbox',
        description: 'Search smartbox.',
        path: '/getSmartbox',
        routePath: '/getSmartbox/:key?',
      }),
    ]);

    expect(tree.groupOrder).toEqual(['group:search', 'group:song']);
    expect(tree.groupMap['group:search']).toEqual({
      id: 'group:search',
      type: 'group',
      label: 'Search',
      childIds: ['get-search-by-key', 'get-smartbox'],
      isExpanded: true,
      itemCount: 2,
    });
    expect(tree.groupMap['group:song']).toEqual({
      id: 'group:song',
      type: 'group',
      label: 'Song',
      childIds: ['get-song-info'],
      isExpanded: true,
      itemCount: 1,
    });
    expect(tree.visibleNodeIds).toEqual([
      'group:search',
      'get-search-by-key',
      'get-smartbox',
      'group:song',
      'get-song-info',
    ]);
  });
});
