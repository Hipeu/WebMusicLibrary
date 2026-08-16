import type { ApiExplorerEndpoint, ApiExplorerMetadata } from '../../src/config/apiExplorer';
import {
  createExplorerInitialState,
  ExplorerStore,
  initializeExplorer,
  selectEndpoint,
  toggleGroup,
  updateMethodFilter,
  updateSearchKeyword,
} from '../../src/explorer/application';

const createEndpoint = (overrides: Partial<ApiExplorerEndpoint> = {}): ApiExplorerEndpoint => ({
  id: 'get-search-by-key',
  name: 'getSearchByKey',
  category: 'Search',
  description: 'Search songs by keyword.',
  method: 'GET',
  routePath: '/getSearchByKey/:key?',
  path: '/getSearchByKey',
  queryParams: [
    {
      key: 'key',
      label: 'Keyword',
      required: true,
      defaultValue: '周杰伦',
    },
  ],
  ...overrides,
});

const createMetadata = (): ApiExplorerMetadata => ({
  title: 'Explorer',
  description: 'Explorer metadata',
  endpoints: [
    createEndpoint(),
    createEndpoint({
      id: 'get-smartbox',
      name: 'getSmartbox',
      description: 'Search smartbox.',
      path: '/getSmartbox',
      routePath: '/getSmartbox/:key?',
      queryParams: [
        {
          key: 'key',
          label: 'Keyword',
          defaultValue: 'Jay',
        },
      ],
    }),
    createEndpoint({
      id: 'batch-get-song-info',
      name: 'batchGetSongInfo',
      category: 'Batch',
      description: 'Batch query song info.',
      method: 'POST',
      path: '/batchGetSongInfo',
      routePath: '/batchGetSongInfo',
      queryParams: undefined,
      bodyExample: {
        songs: [['001', '']],
      },
    }),
  ],
});

describe('ExplorerStore commands', () => {
  it('应基于 metadata 初始化树状态和默认请求状态', () => {
    const store = new ExplorerStore(createExplorerInitialState());

    initializeExplorer(store, createMetadata());

    expect(store.getState().viewState.activeEndpointId).toBe('get-search-by-key');
    expect(store.getState().viewState.expandedGroupIds).toEqual(['group:search', 'group:batch']);
    expect(store.getState().requestState.queryParams).toEqual({
      key: '周杰伦',
    });
    expect(store.getState().resourceState.visibleNodeIds).toEqual([
      'group:search',
      'get-search-by-key',
      'get-smartbox',
      'group:batch',
      'batch-get-song-info',
    ]);
  });

  it('应在切换接口时重置请求状态为新接口默认值', () => {
    const store = new ExplorerStore(createExplorerInitialState());

    initializeExplorer(store, createMetadata());
    store.updateState((state) => ({
      ...state,
      requestState: {
        ...state.requestState,
        queryParams: {
          key: 'custom',
        },
      },
    }));

    selectEndpoint(store, 'batch-get-song-info');

    expect(store.getState().viewState.activeEndpointId).toBe('batch-get-song-info');
    expect(store.getState().requestState.queryParams).toEqual({});
    expect(store.getState().requestState.bodyText).toBe(
      JSON.stringify(
        {
          songs: [['001', '']],
        },
        null,
        2,
      ),
    );
  });

  it('应在折叠分组时只隐藏子节点，不丢失当前筛选状态', () => {
    const store = new ExplorerStore(createExplorerInitialState());

    initializeExplorer(store, createMetadata());
    toggleGroup(store, 'group:search');

    expect(store.getState().viewState.expandedGroupIds).toEqual(['group:batch']);
    expect(store.getState().resourceState.visibleNodeIds).toEqual([
      'group:search',
      'group:batch',
      'batch-get-song-info',
    ]);
  });

  it('应在搜索保持当前接口时保留输入，并在过滤切换接口时重置状态', () => {
    const store = new ExplorerStore(createExplorerInitialState());

    initializeExplorer(store, createMetadata());
    store.updateState((state) => ({
      ...state,
      requestState: {
        ...state.requestState,
        queryParams: {
          key: 'manual-input',
        },
      },
    }));

    updateSearchKeyword(store, 'getsearchbykey');

    expect(store.getState().resourceState.visibleNodeIds).toEqual([
      'group:search',
      'get-search-by-key',
    ]);
    expect(store.getState().requestState.queryParams).toEqual({
      key: 'manual-input',
    });

    updateSearchKeyword(store, '');
    updateMethodFilter(store, 'POST');

    expect(store.getState().resourceState.visibleNodeIds).toEqual([
      'group:batch',
      'batch-get-song-info',
    ]);
    expect(store.getState().viewState.activeEndpointId).toBe('batch-get-song-info');
    expect(store.getState().requestState.queryParams).toEqual({});
  });
});
