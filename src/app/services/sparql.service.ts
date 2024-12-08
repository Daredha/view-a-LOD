import { Injectable } from '@angular/core';
import { Direction, NodeModel, NodeObj } from '../models/node.model';
import { Settings } from '../config/settings';
import { ApiService } from './api.service';
import { wrapWithAngleBrackets } from '../helpers/util.helper';
import { SparqlIncomingRelationModel } from '../models/sparql/sparql-incoming-relation.model';
import { SparqlNodeParentModel } from '../models/sparql/sparql-node-parent.model';
import { ThingWithLabelModel } from '../models/thing-with-label.model';
import { SettingsService } from './settings.service';
import { EndpointService } from './endpoint.service';
import { EndpointUrlsModel } from '../models/endpoint.model';
import { SparqlPredObjModel } from '../models/sparql/sparql-pred-obj.model';

@Injectable({
  providedIn: 'root',
})
export class SparqlService {
  // TODO: Use library for this (e.g., N3.js)
  constructor(
    private api: ApiService,
    private settings: SettingsService,
    private endpoints: EndpointService,
  ) {}

  async getIncomingRelations(
    node: NodeModel,
  ): Promise<SparqlIncomingRelationModel[]> {
    this._ensureNodeHasId(node);
    this._ensureEndpointsExist();

    const query = `
SELECT DISTINCT ?sub ?pred WHERE {
  ?sub ?pred <${node['@id'][0].value}>
}
limit 500`;
    console.log('getIncomingRelations - SPARQL query:', query);
    const response = await this.api.postData<any>(
      this.endpoints.getFirstUrls().sparql,
      {
        query: query,
      },
    );

    // Transform SPARQL JSON results format into array of SparqlIncomingRelationModel
    if (!response.results || !Array.isArray(response.results.bindings)) {
      console.warn('Unexpected SPARQL response format:', response);
      return [];
    }

    return response.results.bindings.map((binding: any) => ({
      sub: binding.sub.value,
      pred: binding.pred.value
    }));
  }

  async getAllParents(node: NodeModel): Promise<SparqlNodeParentModel[]> {
    this._ensureNodeHasId(node);
    this._ensureEndpointsExist();

    const parentIris = Settings.predicates.parents.map((iri) =>
      wrapWithAngleBrackets(iri),
    );
    const labelIris = Settings.predicates.label.map((iri) =>
      wrapWithAngleBrackets(iri),
    );

    const query = `
SELECT DISTINCT ?id ?title ?parent WHERE {
  <${node['@id'][0].value}> ${parentIris.join('*|')}* ?id .
  OPTIONAL { ?id ${labelIris.join('|')} ?title . }
  OPTIONAL { ?id ${parentIris.join('|')} ?parent . }
}
limit 500`;

    const response = await this.api.postData<any>(
      this.endpoints.getFirstUrls().sparql,
      {
        query: query,
      },
    );

    if (!response.results || !Array.isArray(response.results.bindings)) {
      console.warn('Unexpected SPARQL response format:', response);
      return [];
    }

    return response.results.bindings.map((binding: any) => ({
      id: binding.id.value,
      title: binding.title?.value,
      parent: binding.parent?.value
    }));
  }

  async getLabels(ids: string[]): Promise<ThingWithLabelModel[]> {
    const idIrisStr = ids.map((id) => wrapWithAngleBrackets(id)).join('\n');
    const labelIrisStr = Settings.predicates.label
      .map((iri) => wrapWithAngleBrackets(iri))
      .join('|');

    const query = `
SELECT DISTINCT ?s ?label WHERE {
  VALUES ?s {
    ${idIrisStr}
  }
  ?s ${labelIrisStr} ?label .
}
LIMIT 10000`;

    const response = await this.api.postData<any>(
      this.endpoints.getFirstUrls().sparql,
      {
        query: query,
      },
    );

    if (!response.results || !Array.isArray(response.results.bindings)) {
      console.warn('Unexpected SPARQL response format:', response);
      return [];
    }

    return response.results.bindings.map((binding: any) => ({
      '@id': binding.s.value,
      label: binding.label.value
    }));
  }

  async getObjIds(id: string, preds: string[]): Promise<string[]> {
    const predsIrisStr = preds
      .map((pred) => wrapWithAngleBrackets(pred))
      .join('|');

    const query = `
SELECT DISTINCT ?o WHERE {
  ${wrapWithAngleBrackets(id)} ${predsIrisStr} ?o .
}
LIMIT 10000`;

    const response = await this.api.postData<any>(
      this.endpoints.getFirstUrls().sparql,
      {
        query: query,
      },
    );

    if (!response.results || !Array.isArray(response.results.bindings)) {
      console.warn('Unexpected SPARQL response format:', response);
      return [];
    }

    return response.results.bindings.map((binding: any) => binding.o.value);
  }

  async getNode(id: string): Promise<NodeModel> {
    console.log('Retrieving node details using SPARQL...', id);
    this._ensureEndpointsExist();

    const query = `
SELECT DISTINCT ?pred ?obj WHERE {
  ${wrapWithAngleBrackets(id)} ?pred ?obj .
}`;

    // Try each endpoint until we find data
    const endpointUrls = this.endpoints.getAllUrls();
    let nodeData: { [pred: string]: NodeObj[] } = {};
    let successfulEndpoint: string | null = null;

    for (const endpoint of endpointUrls) {
      if (!endpoint.id) {
        console.warn('Skipping endpoint with no ID');
        continue;
      }

      try {
        const response = await this.api.postData<any>(endpoint.sparql, {
          query: query,
        });

        interface Binding {
          pred: { value: string };
          obj: { value: string };
        }

        let results: Array<{pred: string, obj: string}>;

        // Handle both formats:
        if (response.results && Array.isArray(response.results.bindings)) {
          results = response.results.bindings.map((binding: Binding) => ({
            pred: binding.pred.value,
            obj: binding.obj.value
          }));
        } else if (Array.isArray(response)) {
          results = response;
        } else {
          console.warn('Invalid SPARQL response format from endpoint:', endpoint.id);
          continue;
        }

        // If we got results, use this endpoint
        if (results.length > 0) {
          nodeData = {};
          for (const result of results) {
            const pred = result.pred;
            nodeData[pred] = nodeData[pred] || [];
            const nodeObj = {
              value: result.obj,
              direction: Direction.Outgoing,
            };
            nodeData[pred].push(nodeObj);
          }
          successfulEndpoint = endpoint.id;
          break;
        }
      } catch (error) {
        console.warn(`Failed to query endpoint ${endpoint.id}:`, error);
        continue;
      }
    }

    if (!successfulEndpoint) {
      throw new Error(`Could not find data for node ${id} in any endpoint`);
    }

    // Add the ID and endpoint
    nodeData['@id'] = [{ value: id }];
    nodeData['endpointId'] = [{ value: successfulEndpoint }];

    return nodeData as NodeModel;
  }

  private _ensureNodeHasId(node: NodeModel): void {
    const isValidNode =
      node !== undefined &&
      node['@id'] !== undefined &&
      node['@id'].length !== 0;
    if (!isValidNode) {
      throw new Error('Node without ID passed');
    }
  }

  private _ensureEndpointsExist(): void {
    if (Object.keys(Settings.endpoints).length === 0) {
      throw new Error('No endpoints defined');
    }
  }
}
