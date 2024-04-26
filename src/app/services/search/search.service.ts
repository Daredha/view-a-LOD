import { Injectable } from '@angular/core';
import { estypes } from '@elastic/elasticsearch';

import { TypeCountsService } from './type-counts.service';
import { BehaviorSubject } from 'rxjs';
import {
  SearchResultsModel,
  TypeCountsModel,
} from '../../models/search-results.model';
import { ElasticService } from '../elastic.service';
import { NodeModel } from '../../models/node.model';
import { Settings } from '../../config/settings';
import { SearchHitsService } from './search-hits.service';
import {
  ElasticFiltersModel,
  NoElasticFilters,
} from '../../models/elastic/elastic-filters.model';
import { ElasticNodeModel } from '../../models/elastic/elastic-node.model';
import { NodeService } from '../node.service';

@Injectable({
  providedIn: 'root',
})
export class SearchService {
  queryStr: string = Settings.defaultSearchQuery;
  filters: BehaviorSubject<ElasticFiltersModel> =
    new BehaviorSubject<ElasticFiltersModel>(NoElasticFilters);

  results: BehaviorSubject<SearchResultsModel> =
    new BehaviorSubject<SearchResultsModel>({});
  page: number = 0;
  isLoading: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);

  constructor(
    private elastic: ElasticService,
    private typeCounts: TypeCountsService,
    private hits: SearchHitsService,
    private nodes: NodeService,
  ) {
    this._initSearchOnFilterChange();
  }

  private _initSearchOnFilterChange() {
    this.filters.subscribe((filters) => {
      console.log('FILTER CHANGE', filters);
      void this.execute(true);
    });
  }

  hasFilter(filterId: string, filterValue: string) {
    return this.filters.value.terms?.[filterId]?.includes(filterValue);
  }

  toggleFilter(filterId: string, filterValue: string) {
    const currentFilterValues: string[] =
      this.filters.value.terms?.[filterId] || [];
    const updatedFilterSet: Set<string> = new Set(currentFilterValues);
    if (updatedFilterSet.has(filterValue)) {
      updatedFilterSet.delete(filterValue);
    } else {
      updatedFilterSet.add(filterValue);
    }

    const hasFilters = updatedFilterSet.size > 0;
    const updatedFilters = { ...this.filters.value };
    if (hasFilters) {
      updatedFilters.terms[filterId] = Array.from(updatedFilterSet);
    } else {
      delete updatedFilters.terms[filterId];
    }
    this.filters.next(updatedFilters);
    console.log('FILTERS', updatedFilters);
  }

  clearResults() {
    this.results.next({});
    this.page = 0;
  }

  clearFilters() {
    this.filters.next({ terms: {} });
  }

  async execute(clearResults = false) {
    if (clearResults) {
      this.clearResults();
    }

    this.isLoading.next(true);
    try {
      const responses: estypes.SearchResponse<ElasticNodeModel>[] =
        await this.elastic.searchEntities(
          this.queryStr,
          this.filters.value,
          this.page * Settings.search.resultsPerPagePerEndpoint,
          Settings.search.resultsPerPagePerEndpoint,
        );

      const typeCounts: TypeCountsModel =
        this.typeCounts.getFromSearchResponses(responses);
      const hits: estypes.SearchHit<ElasticNodeModel>[] =
        this.hits.getFromSearchResponses(responses);

      const hitNodes: NodeModel[] = this.hits.parseToNodes(hits);
      void this.nodes.enrichWithIncomingRelations(hitNodes);
      const hasHits = hitNodes && hitNodes.length > 0;
      if (hasHits) {
        this.page++;
      }
      this.results.next({
        nodes: [...(this.results.value.nodes ?? []), ...hitNodes],
        typeCounts: typeCounts,
      });
    } catch (error) {
      console.error('Error searching:', error);
    } finally {
      this.isLoading.next(false);
    }
  }
}
